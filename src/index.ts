import { App } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import AirtablePlus from 'airtable-plus';
import { inviteSlackUser, upgradeUser } from './undocumentedSlack';
import http from 'http';

if (!process.env["NODE_ENV"] || process.env["NODE_ENV"] !== "production") {
require('dotenv').config();
}

const envVarsUsed = ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN",
    "SLACK_BROWSER_TOKEN", "SLACK_COOKIE",
    "AIRTABLE_API_KEY", "AIRTABLE_HS_BASE_ID", "AIRTABLE_HS_TABLE_NAME", 
    "AIRTABLE_HS_INVITE_REQUESTED_FIELD_NAME", "AIRTABLE_HS_INVITE_SENT_FIELD_NAME", 
    "AIRTABLE_HS_PROMOTION_REQUESTED_FIELD_NAME", "AIRTABLE_HS_PROMOTED_FIELD_NAME", 
    "AIRTABLE_HS_EMAIL_FIELD_NAME", "AIRTABLE_HS_SLACK_ID_FIELD_NAME",
    "AIRTABLE_HS_HAS_SIGNED_IN_FIELD_NAME", "AIRTABLE_HS_USER_REFERRED_TO_HARBOR_FIELD_NAME",
    "AIRTABLE_HS_FIRST_NAME_FIELD_NAME", "AIRTABLE_HS_LAST_NAME_FIELD_NAME",
    "AIRTABLE_HS_IP_ADDRESS_FIELD_NAME", "AIRTABLE_JR_BASE_ID",
    "AIRTABLE_JR_TABLE_NAME", "AIRTABLE_JR_EMAIL_FIELD_NAME",
    "AIRTABLE_JR_INVITED_FIELD_NAME", "AIRTABLE_JR_UNINVITABLE_FIELD_NAME",
    "AIRTABLE_JR_IP_ADDRESS_FIELD_NAME", "AIRTABLE_JR_FIRST_NAME_FIELD_NAME",
    "AIRTABLE_JR_LAST_NAME_FIELD_NAME",
    "AIRTABLE_MR_TABLE_NAME", "AIRTABLE_MR_REQUESTER_FIELD_NAME",
    "AIRTABLE_MR_TARGET_FIELD_NAME", "AIRTABLE_MR_MSG_TEXT_FIELD_NAME",
    "AIRTABLE_MR_MSG_BLOCKS_FIELD_NAME", "AIRTABLE_MR_SEND_SUCCESS_FIELD_NAME",
    "AIRTABLE_MR_SEND_FAILURE_FIELD_NAME", "AIRTABLE_MR_FAILURE_REASON_FIELD_NAME",
    "AIRTABLE_MR_AUTONUMBER_FIELD_NAME",
    "SLACK_WELCOME_MESSAGE", "SLACK_LOGGING_CHANNEL",
    "PORT", "AIRTABLE_POLLING_RATE_MS"];
const missingEnvVars = envVarsUsed.filter(envVar => !process.env[envVar]);
if (missingEnvVars.length > 0) {
    console.error(`Missing environment variables: ${missingEnvVars.join(', ')}`);
    process.exit(1);
}

// Initialize the app with the bot token and socket mode app token
const app = new App({
  token: process.env.SLACK_BOT_TOKEN, // Bot token from OAuth
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN, // App-level token for socket mode
});

const high_seas_airtable = new AirtablePlus({
    baseID: process.env.AIRTABLE_HS_BASE_ID!,
    apiKey: process.env.AIRTABLE_API_KEY!,
    tableName: process.env.AIRTABLE_HS_TABLE_NAME!
    });

const message_requests_airtable = new AirtablePlus({
    baseID: process.env.AIRTABLE_HS_BASE_ID!,
    apiKey: process.env.AIRTABLE_API_KEY!,
    tableName: process.env.AIRTABLE_MR_TABLE_NAME!
    });

const join_requests_airtable = new AirtablePlus({
    baseID: process.env.AIRTABLE_JR_BASE_ID!,
    apiKey: process.env.AIRTABLE_API_KEY!,
    tableName: process.env.AIRTABLE_JR_TABLE_NAME!
    });

async function pollAirtable() {
    console.log('Polling airtable');
    let messageRequests = undefined;
    try {
         messageRequests = await message_requests_airtable.read({
            filterByFormula: `AND(NOT({${process.env.AIRTABLE_MR_SEND_SUCCESS_FIELD_NAME}}), NOT({${process.env.AIRTABLE_MR_SEND_FAILURE_FIELD_NAME}}))`,
            maxRecords: 5,
            sort: [{field: process.env.AIRTABLE_MR_AUTONUMBER_FIELD_NAME, direction: 'asc'}]
        });
    } catch (error) {
        console.error('Error reading message requests airtable:', error);
        app.client.chat.postMessage({
            channel: process.env.SLACK_LOGGING_CHANNEL,
            text: `ERROR: Error reading message requests airtable: ${error}`
        });
    }

    if (messageRequests && messageRequests.length > 0){
        for (const messageRequest of messageRequests) {
            await sendMessage(messageRequest);
        }
    }
    console.log(`all ${messageRequests ? 0 : messageRequests.length} messages handled.`)
    return; // for testing: only handle message requests for now

    try {
        const joinRequestsRecords = await join_requests_airtable.read({
            filterByFormula: `AND(NOT({${process.env.AIRTABLE_JR_INVITED_FIELD_NAME}}), NOT({${process.env.AIRTABLE_JR_UNINVITABLE_FIELD_NAME}}))`,
            maxRecords: 1,
        });

        if (joinRequestsRecords.length > 0) {
            console.log('Inviting user');
            // invite user
            await handleJoinRequest(joinRequestsRecords[0]);
        }
    } catch (error) {
        console.error('Error reading join requests airtable:', error);
    }

    try {
        const highSeasRecords = await high_seas_airtable.read({
            filterByFormula: `AND({${process.env.AIRTABLE_HS_PROMOTION_REQUESTED_FIELD_NAME}}, NOT({${process.env.AIRTABLE_HS_PROMOTED_FIELD_NAME}}))`,
            maxRecords: 1,
        });

        if (highSeasRecords.length > 0) {
            console.log('Promoting user');
            const result = await upgradeUser(app.client, highSeasRecords[0].fields[process.env.AIRTABLE_HS_SLACK_ID_FIELD_NAME]);
            if (result.ok) {
                await high_seas_airtable.update(highSeasRecords[0].id, {
                    [process.env.AIRTABLE_HS_PROMOTED_FIELD_NAME]: true
                });
            }
        }
    } catch (error) {
        console.error('Error reading high seas airtable:', error);
    }
}

async function sendMessage(messageRequest) {
    const requesterId = messageRequest.fields[process.env.AIRTABLE_MR_REQUESTER_FIELD_NAME];
    if (!requesterId) {
        console.error(`Error: no requester id found for message request ${messageRequest.id}`);
        await message_requests_airtable.update(messageRequest.id, {
            [process.env.AIRTABLE_MR_SEND_FAILURE_FIELD_NAME]: true,
            [process.env.AIRTABLE_MR_FAILURE_REASON_FIELD_NAME]: 'No requester identifier found. Make sure you\'re filling out all needed fields.'
        });
        return;
    }
    const targetSlackId = messageRequest.fields[process.env.AIRTABLE_MR_TARGET_FIELD_NAME];
    if (!targetSlackId) {
        console.error(`Error: no target slack id found for message request ${messageRequest.id}`);
        await message_requests_airtable.update(messageRequest.id, {
            [process.env.AIRTABLE_MR_SEND_FAILURE_FIELD_NAME]: true,
            [process.env.AIRTABLE_MR_FAILURE_REASON_FIELD_NAME]: 'No target slack id found. Make sure you\'re filling out all needed fields.'
        });
        return;
    }
    const msgText = messageRequest.fields[process.env.AIRTABLE_MR_MSG_TEXT_FIELD_NAME];
    if (!msgText) {
        console.error(`Error: no message text found for message request ${messageRequest.id}`);
        await message_requests_airtable.update(messageRequest.id, {
            [process.env.AIRTABLE_MR_SEND_FAILURE_FIELD_NAME]: true,
            [process.env.AIRTABLE_MR_FAILURE_REASON_FIELD_NAME]: 'No message text found. Make sure you\'re filling out all needed fields.'
        });
        return;
    }
    const msgBlocksStr = messageRequest.fields[process.env.AIRTABLE_MR_MSG_BLOCKS_FIELD_NAME];
    let msgBlocks = undefined;
    if (msgBlocksStr) {
        try {
            msgBlocks = JSON.parse(msgBlocksStr);
            console.log(`Parsed message blocks from message request ${messageRequest.id}`);
        } catch (error) {
            console.error(`Error parsing message blocks for message request ${messageRequest.id}: ${error}`);
            await message_requests_airtable.update(messageRequest.id, {
                [process.env.AIRTABLE_MR_SEND_FAILURE_FIELD_NAME]: true,
                [process.env.AIRTABLE_MR_FAILURE_REASON_FIELD_NAME]: `Error parsing message blocks: ${error}`
            });
            return;
        }
    }
    console.log(`Sending message to ${targetSlackId} from ${requesterId} (${msgBlocks ? "with": "with no"} blocks): ${msgText.substring(0, 50)}...`);
    let errorMsg = undefined;
    try {
        const result = await app.client.chat.postMessage({
            channel: targetSlackId,
            text: msgText,
            blocks: msgBlocks ? msgBlocks : undefined
        });
        if (!result.ok) {
            errorMsg = result.error;
        }
    } catch (error) {
        errorMsg = error.message;
    }
    if (errorMsg) {
        console.error(`Error sending message to ${targetSlackId}: ${errorMsg}`);
        await message_requests_airtable.update(messageRequest.id, {
            [process.env.AIRTABLE_MR_SEND_FAILURE_FIELD_NAME]: true,
            [process.env.AIRTABLE_MR_FAILURE_REASON_FIELD_NAME]: errorMsg
        });
    } else {
        console.log('... message sent successfully.');
        await message_requests_airtable.update(messageRequest.id, {
            [process.env.AIRTABLE_MR_SEND_SUCCESS_FIELD_NAME]: true
        });
    }
    console.log("message handled.")
}

async function handleJoinRequest(joinRequestRecord) {
    // invite user to slack
    console.log('Inviting user to Slack');
    const email = joinRequestRecord.fields[process.env.AIRTABLE_JR_EMAIL_FIELD_NAME];

    const result = await inviteSlackUser({email});
    console.log('Result of inviting user to Slack');
    console.log(result);
    if (!result.ok) {
        console.error(`Error inviting user ${email} to Slack`);
        join_requests_airtable.update(joinRequestRecord.id, {
            [process.env.AIRTABLE_JR_UNINVITABLE_FIELD_NAME]: true
        });
        return result;
    }
    // update Join Requests record
    join_requests_airtable.update(joinRequestRecord.id, {
        [process.env.AIRTABLE_JR_INVITED_FIELD_NAME]: true
    });
    // carry new info into High Seas record
    const firstName = joinRequestRecord.fields[process.env.AIRTABLE_JR_FIRST_NAME_FIELD_NAME];
    const lastName = joinRequestRecord.fields[process.env.AIRTABLE_JR_LAST_NAME_FIELD_NAME];
    const ipAddress = joinRequestRecord.fields[process.env.AIRTABLE_JR_IP_ADDRESS_FIELD_NAME];
    await high_seas_airtable.create({
        [process.env.AIRTABLE_HS_EMAIL_FIELD_NAME]: email,
        [process.env.AIRTABLE_HS_FIRST_NAME_FIELD_NAME]: firstName,
        [process.env.AIRTABLE_HS_LAST_NAME_FIELD_NAME]: lastName,
        [process.env.AIRTABLE_HS_IP_ADDRESS_FIELD_NAME]: ipAddress,
        [process.env.AIRTABLE_HS_INVITE_REQUESTED_FIELD_NAME]: true,
        [process.env.AIRTABLE_HS_INVITE_SENT_FIELD_NAME]: true
    });
    return result;
}

// welcomes new users
app.event('team_join', async ({ event, client }) => {
    console.log("New member joined!")
    // find airtable record by email and update it w/ slack id
    const userInfo = await client.users.info({ user: event.user.id });
    console.log(`User info: ${JSON.stringify(userInfo, null, 2)}`);
    const email = userInfo.user.profile.email;
    console.log(`Email: ${email}`);
    if (!email) {
        const errorString = `ERROR: When welcoming user, no email found for user <@${event.user.id}>. Event: ${JSON.stringify(event, null, 2)}, User info: ${JSON.stringify(userInfo, null, 2)}`;
        console.error(errorString);
        await client.chat.postMessage({
            channel: process.env.SLACK_LOGGING_CHANNEL,
            text: errorString
        });
        return;
    }
    const userRecords = await high_seas_airtable.read({
        filterByFormula: `{${process.env.AIRTABLE_HS_EMAIL_FIELD_NAME}} = '${email}'`
    });
    console.log(`Got ${userRecords.length} records`);
    if (userRecords.length === 0) {
        const errorString = `ERROR: When welcoming user, no airtable record found for user <@${event.user.id}> with email ${email}`;
        console.error(errorString);
        await client.chat.postMessage({
            channel: process.env.SLACK_LOGGING_CHANNEL,
            text: errorString
        });
        return;
    }
    if (userRecords.length > 1) {
        const errorString = `ERROR: When welcoming user, multiple airtable records found for user <@${event.user.id}> with email ${email}`;
        console.error(errorString);
        await client.chat.postMessage({
            channel: process.env.SLACK_LOGGING_CHANNEL,
            text: errorString
        });
        return;
    }
    const userRecord = userRecords[0];
    console.log(`User record: ${JSON.stringify(userRecord)}`);
    await high_seas_airtable.update(userRecord.id, {
        [process.env.AIRTABLE_HS_SLACK_ID_FIELD_NAME]: event.user.id,
        [process.env.AIRTABLE_HS_USER_REFERRED_TO_HARBOR_FIELD_NAME]: true,
        [process.env.AIRTABLE_HS_HAS_SIGNED_IN_FIELD_NAME]: true // those square brackets are ES6 computed property names
    });
    console.log(`Updated user record with slack id ${event.user.id}`);
    // send welcome message
    await client.chat.postMessage({
        channel: event.user.id,
        text: process.env.SLACK_WELCOME_MESSAGE
    });

});

const server = http.createServer();
server.on('request', async (req, res) => {
    console.log(`Got request: ${req.method} ${req.url}`);
    // check if the request is a POST to /invite-user
    if (req.method === 'POST' && req.url === '/invite-user') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', async () => {
            let data;
            try {
                data = JSON.parse(body);
            }
            catch (error) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Invalid JSON');
                return;
            }
            console.log('Invite user data:', data);
            const userEmail = data.email;
            const userRecord = await join_requests_airtable.read({
                filterByFormula: `{${process.env.AIRTABLE_JR_EMAIL_FIELD_NAME}} = '${userEmail}'`,
                maxRecords: 1,
                sort: [{field: 'autonumber', direction: 'desc'}]
            });
            if (userRecord.length === 0) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('User not found in Airtable');
                return;
            }
            const result = await handleJoinRequest(userRecord[0]);
            if (result.ok) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            } else {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            }
        });
    } else if (req.method === 'POST' && req.url === '/upgrade-user') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', async () => {
            let data;
            try {
                data = JSON.parse(body);
            }
            catch (error) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Invalid JSON');
                return;
            }
            console.log('Upgrade user data:', data);
            const userSlackId = data.slack_id;
            const userRecord = await high_seas_airtable.read({
                filterByFormula: `{${process.env.AIRTABLE_HS_SLACK_ID_FIELD_NAME}} = '${userSlackId}'`,
                maxRecords: 1,
                sort: [{field: 'autonumber', direction: 'desc'}]
            });
            if (userRecord.length === 0) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('User not found in Airtable');
                return;
            }
            const result = await upgradeUser(app.client, userSlackId);
            if (result.ok) {
                await high_seas_airtable.update(userRecord[0].id, {
                    [process.env.AIRTABLE_HS_PROMOTED_FIELD_NAME]: true
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            } else {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            }
        });
    } else {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Requests only POST to /invite-user');
    }
});


// Start the app
(async () => {
    await app.start();
    console.log('⚡️ Bolt app is running!');
    await app.client.chat.postMessage({
        channel: process.env.SLACK_LOGGING_CHANNEL,
        text: 'INFO: Bot has just started!'
    });
    server.listen(process.env.PORT);
    console.log(`Server listening on port ${process.env.PORT}`);
    // poll airtable every 30 seconds
    setInterval(pollAirtable, parseInt(process.env.AIRTABLE_POLLING_RATE_MS));
})();
