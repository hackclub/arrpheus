import { App } from '@slack/bolt';
import { AirtableFetch } from './airtableFetch';
import AirtablePlus from 'airtable-plus';
import { inviteSlackUser, upgradeUser, inviteMCGToChannel } from './undocumentedSlack';
import http from 'http';

if (!process.env["NODE_ENV"] || process.env["NODE_ENV"] !== "production") {
require('dotenv').config();
}

// new-style config vars that are actually checked into git (:
const AT_PEOPLE_IS_MCG_FIELD_NAME = "preexisting_multi_channel_guest";
const CHANNELS_ON_JOIN = "C75M7C0SY,C07PZMBUNDS,C07TNAZGMHS,C07UA18MXBJ,C07PZNMBPBN,C016DEDUL87" // #welcome, #high-seas, #high-seas-bulletin, #high-seas-ships, #high-seas-help, #cdn
const CHANNELS_ON_PROMOTION = "C0266FRGV,C078Q8PBD4G,C01504DCLVD,C0EA9S0A0,C05B6DBN802,C08358F9XU6" // #lounge, #library, #scrapbook, #code, #happenings, #rate-my-ship
const NORMAL_POLLING_RATE_MS = 7000;
const FALLBACK_POLLING_RATE_MS = 30000;
let currentPollingRate = NORMAL_POLLING_RATE_MS;
let returnToNormalCountdown = 0;

// a note on env var naming conventions:
// the HS/JR/JRB/MR prefixes refer to the purpose of that field.
// they've gotten a little muddied and were clearer in older versions.
// in theory, they're for High Seas, Join Requests, Join Requests Base, and Message Requests, respectively.
// Join Requests is for fields in the people table in the High Seas base.
// Join Requests Base is for fields in the *separate* Join Requests base.
// HS and JR have some overlap.
// ... it's a mess. sorry.

const envVarsUsed = ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN",
    "SLACK_BROWSER_TOKEN", "SLACK_COOKIE",
    "AIRTABLE_API_KEY", "AIRTABLE_HS_BASE_ID", "AIRTABLE_HS_TABLE_NAME", 
    "AIRTABLE_HS_PROMOTION_REQUESTED_FIELD_NAME", "AIRTABLE_HS_PROMOTED_FIELD_NAME",
    "AIRTABLE_HS_PROMOTE_FAILED_FIELD_NAME", "AIRTABLE_HS_PROMOTE_FAILURE_REASON_FIELD_NAME",
    "AIRTABLE_HS_EMAIL_FIELD_NAME", "AIRTABLE_HS_SLACK_ID_FIELD_NAME",
    "AIRTABLE_HS_HAS_SIGNED_IN_FIELD_NAME", "AIRTABLE_HS_USER_REFERRED_TO_HARBOR_FIELD_NAME",
    "AIRTABLE_JR_INVITED_FIELD_NAME", "AIRTABLE_JR_UNINVITABLE_FIELD_NAME",
    "AIRTABLE_JR_INVITE_REQUESTED_FIELD_NAME",
    "AIRTABLE_JR_INVITE_FAILURE_REASON_FIELD_NAME", "AIRTABLE_JR_DUPE_EMAIL_FIELD_NAME",
    "AIRTABLE_JR_AUTH_TOKEN_FIELD_NAME", "AIRTABLE_JR_AUTH_MESSAGE_FIELD_NAME",
    "AIRTABLE_JR_FIRST_NAME_FIELD_NAME", "AIRTABLE_JR_LAST_NAME_FIELD_NAME",
    "AIRTABLE_JR_IP_ADDR_FIELD_NAME", "AIRTABLE_JR_AUTH_MESSAGE_BLOCKS_FIELD_NAME",
    "AIRTABLE_JRB_BASE_ID", "AIRTABLE_JRB_TABLE_NAME",
    "AIRTABLE_JRB_FIRST_NAME_FIELD_NAME", "AIRTABLE_JRB_EMAIL_FIELD_NAME",
    "AIRTABLE_JRB_LAST_NAME_FIELD_NAME", "AIRTABLE_JRB_IP_ADDR_FIELD_NAME",
    "AIRTABLE_MR_TABLE_NAME", "AIRTABLE_MR_REQUESTER_FIELD_NAME",
    "AIRTABLE_MR_TARGET_FIELD_NAME", "AIRTABLE_MR_MSG_TEXT_FIELD_NAME",
    "AIRTABLE_MR_MSG_BLOCKS_FIELD_NAME", "AIRTABLE_MR_SEND_SUCCESS_FIELD_NAME",
    "AIRTABLE_MR_SEND_FAILURE_FIELD_NAME", "AIRTABLE_MR_FAILURE_REASON_FIELD_NAME",
    "AIRTABLE_MR_AUTONUMBER_FIELD_NAME",
    "AIRTABLE_MR_UNFURL_LINKS_FIELD_NAME", "AIRTABLE_MR_UNFURL_MEDIA_FIELD_NAME",
    "AIRTABLE_CONFIG_TABLE_NAME",
    "AIRTABLE_CONFIG_PROMOTION_CHANNELS_FIELD_NAME", "AIRTABLE_CONFIG_JOIN_CHANNELS_FIELD_NAME",
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

const people_airtable = new AirtableFetch({
    baseID: process.env.AIRTABLE_HS_BASE_ID!,
    apiKey: process.env.AIRTABLE_API_KEY!,
    tableName: process.env.AIRTABLE_HS_TABLE_NAME!
    });

const message_requests_airtable = new AirtableFetch({
    baseID: process.env.AIRTABLE_HS_BASE_ID!,
    apiKey: process.env.AIRTABLE_API_KEY!,
    tableName: process.env.AIRTABLE_MR_TABLE_NAME!
    });

const join_requests_base_airtable = new AirtableFetch({
    baseID: process.env.AIRTABLE_JRB_BASE_ID!,
    apiKey: process.env.AIRTABLE_API_KEY!,
    tableName: process.env.AIRTABLE_JRB_TABLE_NAME!
    });

// const config_airtable = new AirtableFetch({
//     baseID: process.env.AIRTABLE_HS_BASE_ID!,
//     apiKey: process.env.AIRTABLE_API_KEY!,
//     tableName: process.env.AIRTABLE_CONFIG_TABLE_NAME!
//     });


async function pollAirtable() {
    console.log('Polling airtable');
    let messageRequests = undefined;
    let hadError = false;
    try {
         messageRequests = await message_requests_airtable.read({
            filterByFormula: `AND(NOT({${process.env.AIRTABLE_MR_SEND_SUCCESS_FIELD_NAME}}), NOT({${process.env.AIRTABLE_MR_SEND_FAILURE_FIELD_NAME}}))`,
            maxRecords: 10,
            sortString: "sort%5B0%5D%5Bfield%5D=autonumber&sort%5B0%5D%5Bdirection%5D=asc" // sort by autonumber, ascending
            //sort: [{field: process.env.AIRTABLE_MR_AUTONUMBER_FIELD_NAME, direction: 'asc'}] just going to not implement this cursed encoding scheme, it'll only become a problem if the backlog grows and then we have bigger problems anyways
        }, 'Arrpheus.poll.msg/1.0.0');
    } catch (error) {
        hadError = true;
        console.error('Error reading message requests airtable:', error);
        app.client.chat.postMessage({
            channel: process.env.SLACK_LOGGING_CHANNEL,
            text: `ERROR: Error reading message requests airtable: ${error}`
        });
        if (error.message.includes("50")){
            if (currentPollingRate === NORMAL_POLLING_RATE_MS) {
                console.log(`Error 50x, falling back to slower polling rate:`);
                currentPollingRate = FALLBACK_POLLING_RATE_MS;
                await app.client.chat.postMessage({
                    channel: process.env.SLACK_LOGGING_CHANNEL,
                    text: `INFO: Falling back to slower polling rate: ${currentPollingRate}ms <@U05PYFCJXV0>`
                });
            }
            returnToNormalCountdown = 3;
        }
    }
    if (!hadError && returnToNormalCountdown > 0) {
        console.log(`Error 50x resolved, returning to normal polling rate in ${returnToNormalCountdown} polls.`);
        returnToNormalCountdown--;
    }

    if (messageRequests && messageRequests.length > 0){
        let updatedRecords = [];
        for (const messageRequest of messageRequests) {
            updatedRecords.push(await sendMessage(messageRequest));
        }
        console.log(`Message requests: updating ${updatedRecords.length} records...`);
        await message_requests_airtable.updateBulk(updatedRecords, 'Arrpheus.poll.msg/1.0.0');
    }
    console.log(`all ${messageRequests ? messageRequests.length : 0} messages handled.`)

    try {
        let updatedRecords = [];
        const joinRequestsRecords = await people_airtable.read({
            filterByFormula: `AND(NOT({${process.env.AIRTABLE_JR_INVITED_FIELD_NAME}}), NOT({${process.env.AIRTABLE_JR_UNINVITABLE_FIELD_NAME}}), {${process.env.AIRTABLE_JR_INVITE_REQUESTED_FIELD_NAME}})`,
            maxRecords: 10,
            sortString: "sort%5B0%5D%5Bfield%5D=autonumber&sort%5B0%5D%5Bdirection%5D=asc" // sort by autonumber, ascending
        }, 'Arrpheus.poll.jr/1.0.0');

        for (const joinRequest of joinRequestsRecords) {
            console.log('Inviting user');
            // invite user
            const result = await handleJoinRequest(joinRequest);
            console.log('Result of inviting user');
            console.log(result);
            updatedRecords.push(result['airtableRecord']);
        }
        if (updatedRecords.length > 0) {
            console.log(`Join requests: updating ${updatedRecords.length} records:`);
            console.log(updatedRecords);
            await people_airtable.updateBulk(updatedRecords, 'Arrpheus.poll.jr/1.0.0');
        }
    } catch (error) {
        console.error('Error reading join requests airtable:', error);
    }

    try {
        const highSeasRecords = await people_airtable.read({
            filterByFormula: `AND({${process.env.AIRTABLE_HS_PROMOTION_REQUESTED_FIELD_NAME}}, NOT({${process.env.AIRTABLE_HS_PROMOTED_FIELD_NAME}}), NOT({${process.env.AIRTABLE_HS_PROMOTE_FAILED_FIELD_NAME}}))`,
            maxRecords: 1,
            sortString: "sort%5B0%5D%5Bfield%5D=autonumber&sort%5B0%5D%5Bdirection%5D=asc" // sort by autonumber, ascending
        }, 'Arrpheus.poll.promo/1.0.0');

        if (highSeasRecords.length > 0) {
            console.log('Promoting user');
            const result = await upgradeUser(app.client, highSeasRecords[0].fields[process.env.AIRTABLE_HS_SLACK_ID_FIELD_NAME], CHANNELS_ON_PROMOTION);
            if (result.ok) {
                try {
                    await people_airtable.update(highSeasRecords[0].id, {
                        [process.env.AIRTABLE_HS_PROMOTED_FIELD_NAME]: true
                    }, 'Arrpheus.poll.promo/1.0.0');
                } catch (error) {
                    console.error(`Error updating airtable after successful promotion: ${error}`);
                }
            } else {
                try {
                    await people_airtable.update(highSeasRecords[0].id, {
                        [process.env.AIRTABLE_HS_PROMOTE_FAILED_FIELD_NAME]: true,
                        [process.env.AIRTABLE_HS_PROMOTE_FAILURE_REASON_FIELD_NAME]: result.error
                    }, 'Arrpheus.poll.promo/1.0.0');
                } catch (error) {
                    console.error(`Error updating airtable after failed promotion: ${error}`);
                }
            }
        }
    } catch (error) {
        console.error('Error reading high seas airtable:', error);
    }

    if (currentPollingRate === FALLBACK_POLLING_RATE_MS && returnToNormalCountdown === 0) {
        console.log(`Returning to normal polling rate: ${NORMAL_POLLING_RATE_MS}ms`);
        currentPollingRate = NORMAL_POLLING_RATE_MS;
        await app.client.chat.postMessage({
            channel: process.env.SLACK_LOGGING_CHANNEL,
            text: `INFO: Returning to normal polling rate: ${currentPollingRate}ms <@U05PYFCJXV0>`
        });
    }
    setTimeout(pollAirtable, currentPollingRate);
}

async function sendMessage(messageRequest) {
    const requesterId = messageRequest.fields[process.env.AIRTABLE_MR_REQUESTER_FIELD_NAME];
    if (!requesterId) {
        console.error(`Error: no requester id found for message request ${messageRequest.id}`);
        return {
            id: messageRequest.id,
            fields: {
                [process.env.AIRTABLE_MR_SEND_FAILURE_FIELD_NAME]: true,
                [process.env.AIRTABLE_MR_FAILURE_REASON_FIELD_NAME]: 'No requester identifier found. Make sure you\'re filling out all needed fields.'
            }
        }
    }
    const targetSlackId = messageRequest.fields[process.env.AIRTABLE_MR_TARGET_FIELD_NAME];
    if (!targetSlackId) {
        console.error(`Error: no target slack id found for message request ${messageRequest.id}`);
        return {
            id: messageRequest.id,
            fields: {
                [process.env.AIRTABLE_MR_SEND_FAILURE_FIELD_NAME]: true,
                [process.env.AIRTABLE_MR_FAILURE_REASON_FIELD_NAME]: 'No target Slack ID found. Make sure you\'re filling out all needed fields.'
            }
        }
    }
    const msgText = messageRequest.fields[process.env.AIRTABLE_MR_MSG_TEXT_FIELD_NAME];
    if (!msgText) {
        console.error(`Error: no message text found for message request ${messageRequest.id}`);
        return {
            id: messageRequest.id,
            fields: {
                [process.env.AIRTABLE_MR_SEND_FAILURE_FIELD_NAME]: true,
                [process.env.AIRTABLE_MR_FAILURE_REASON_FIELD_NAME]: 'No message text found. Make sure you\'re filling out all needed fields.'
            }
        }
    }
    const msgBlocksStr = messageRequest.fields[process.env.AIRTABLE_MR_MSG_BLOCKS_FIELD_NAME];
    let msgBlocks = undefined;
    if (msgBlocksStr) {
        try {
            msgBlocks = JSON.parse(msgBlocksStr);
            console.log(`Parsed message blocks from message request ${messageRequest.id}`);
        } catch (error) {
            console.error(`Error parsing message blocks for message request ${messageRequest.id}: ${error}`);
            return {
                id: messageRequest.id, 
                fields: {
                    [process.env.AIRTABLE_MR_SEND_FAILURE_FIELD_NAME]: true,
                    [process.env.AIRTABLE_MR_FAILURE_REASON_FIELD_NAME]: `Error parsing message blocks: ${error}`
                }
            };
        }
    }
    let unfurlLinks = !!messageRequest.fields[process.env.AIRTABLE_MR_UNFURL_LINKS_FIELD_NAME]; // cast to boolean
    let unfurlMedia = !!messageRequest.fields[process.env.AIRTABLE_MR_UNFURL_MEDIA_FIELD_NAME];
    console.log(`Sending message to ${targetSlackId} from ${requesterId} (${msgBlocks ? "with": "with no"} blocks, unfurling links: ${unfurlLinks}, unfurling media: ${unfurlMedia}): ${msgText.substring(0, 50)}...`);
    let errorMsg = undefined;
    try {
        const result = await app.client.chat.postMessage({
            channel: targetSlackId,
            text: msgText,
            blocks: msgBlocks ? msgBlocks : undefined,
            unfurl_links: unfurlLinks,
            unfurl_media: unfurlMedia
        });
        if (!result.ok) {
            errorMsg = result.error;
        }
    } catch (error) {
        errorMsg = error.message;
    }
    if (errorMsg) {
        console.error(`Error sending message to ${targetSlackId}: ${errorMsg}`);
        return {
            id: messageRequest.id,
            fields: {
                [process.env.AIRTABLE_MR_SEND_FAILURE_FIELD_NAME]: true,
                [process.env.AIRTABLE_MR_FAILURE_REASON_FIELD_NAME]: errorMsg
            }
        }
    } else {
        console.log('... message sent successfully.');
        return {
            id: messageRequest.id,
            fields: {
                [process.env.AIRTABLE_MR_SEND_SUCCESS_FIELD_NAME]: true
            }
        }
    }
    console.log("message handled.")
}

function generateUUID() {
    // Generate a random UUID (version 4)
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

async function handleJoinRequest(joinRequestRecord) {
    // invite user to slack
    console.log('Inviting user to Slack');
    const email = joinRequestRecord.fields[process.env.AIRTABLE_HS_EMAIL_FIELD_NAME];

    const result = await inviteSlackUser({email, channels: CHANNELS_ON_JOIN});
    console.log('Result of inviting user to Slack');
    console.log(result);
    if (!result.ok) {
        console.error(`Error inviting user ${email} to Slack`);

        const emailIsDupe = result.error.includes("already_in_team");
        let dupedUserId = undefined;
        let userIsMCG = false;
        if (emailIsDupe) {
            console.log(`Attempting to deduplicate user ${email}`);
            try {
                const searchResponse = await app.client.users.lookupByEmail({ email });
                if (searchResponse.ok) {
                    dupedUserId = searchResponse.user?.id;
                    console.log(`Deduplicated user ${email} to ${dupedUserId}`);
                    // check if user is a multi-channel guest
                    userIsMCG = searchResponse.user?.is_restricted;
                } else {
                    throw new Error(`Error looking up user by email ${email}: ${searchResponse.error}`);
                }
            } catch (error) {
                console.error(`Error looking up user by email ${email}: ${error}`);
                await app.client.chat.postMessage({
                    channel: process.env.SLACK_LOGGING_CHANNEL,
                    text: `ERROR: Error looking duplicate up user by email ${email}: ${error}`
                });
            }
        }

        let fields = {
            [process.env.AIRTABLE_JR_UNINVITABLE_FIELD_NAME]: true,
            [process.env.AIRTABLE_JR_INVITE_FAILURE_REASON_FIELD_NAME]: result.error,
            [process.env.AIRTABLE_JR_DUPE_EMAIL_FIELD_NAME]: emailIsDupe,
        }

        if (dupedUserId) {
            fields[process.env.AIRTABLE_HS_SLACK_ID_FIELD_NAME] = dupedUserId;
            if(userIsMCG) {
                console.log(`User ${dupedUserId} is a multi-channel guest, inviting them to new channels...`);
                for(const channel of CHANNELS_ON_JOIN.split(',')) {
                    try {
                        await inviteMCGToChannel(app.client, dupedUserId, channel);
                        console.log(`Invited user ${dupedUserId} to channel ${channel}`);
                    } catch (error) {
                        console.error(`Error inviting duped MCG user ${dupedUserId} to channel ${channel}: ${error}`);
                        await app.client.chat.postMessage({
                            channel: process.env.SLACK_LOGGING_CHANNEL,
                            text: `ERROR: Error inviting duped MCG user ${dupedUserId} to channel ${channel}: ${error}`
                        });
                    }
                }

                fields[process.env.AIRTABLE_JR_AUTH_TOKEN_FIELD_NAME] = generateUUID();
                fields[AT_PEOPLE_IS_MCG_FIELD_NAME] = true;
                // we don't DM them from here. for ease of flow, an airtable automation will handle that with a message request.
            }
        }
        
        result['airtableRecord'] = { 
            id: joinRequestRecord.id, 
            fields,
        };
        return result;
    }
    // update Join Requests record
    result['airtableRecord'] = {
        id: joinRequestRecord.id, 
        fields: {
            [process.env.AIRTABLE_JR_INVITED_FIELD_NAME]: true,
            [process.env.AIRTABLE_JR_AUTH_TOKEN_FIELD_NAME]: generateUUID(),
        }
    }

    // also log to join requests base
    // actually we're not doing this, see https://hackclub.slack.com/archives/C07MS92E0J3/p1729880392714889?thread_ts=1729878568.963819&cid=C07MS92E0J3
    // join_requests_base_airtable.create({
    //     [process.env.AIRTABLE_JRB_FIRST_NAME_FIELD_NAME]: joinRequestRecord.fields[process.env.AIRTABLE_JR_FIRST_NAME_FIELD_NAME],
    //     [process.env.AIRTABLE_JRB_LAST_NAME_FIELD_NAME]: joinRequestRecord.fields[process.env.AIRTABLE_JR_LAST_NAME_FIELD_NAME],
    //     [process.env.AIRTABLE_JRB_EMAIL_FIELD_NAME]: email,
    //     [process.env.AIRTABLE_JRB_IP_ADDR_FIELD_NAME]: joinRequestRecord.fields[process.env.AIRTABLE_JR_IP_ADDR_FIELD_NAME],
    // });
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
    let userRecords = [];
    try {
        userRecords = await people_airtable.read({
            filterByFormula: `{${process.env.AIRTABLE_HS_EMAIL_FIELD_NAME}} = '${email}'`,
        }, 'Arrpheus.team_join/1.0.0');
    } catch (error) {
        console.error(`Error reading user records for user <@${event.user.id}> with email ${email}: ${error}. attempting to fall back to jrb...`);
        fallbackUserLog(client, email, event);
        await client.chat.postMessage({
            channel: event.user.id,
            text: "Ahoy, matey! Welcome to High Seas! We be under heavy load at the moment, watch this space for a link to continue to arrive in the next few hours! If you don't get something soon, make a post in <#C07PZNMBPBN>.",
            username: 'Arrpheus',
            icon_url: 'https://noras-secret-cdn.hackclub.dev/yeah_of_course_river_np.png'}
        );
        console.log(`${event.user.id} has been notified of heavy load (on read).`);
        return;
    }
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
    const msgBlocksStr = userRecord.fields[process.env.AIRTABLE_HS_WELCOME_MESSAGE_BLOCKS_FIELD_NAME];
    let msgBlocks = undefined;
    if (msgBlocksStr) {
        try {
            msgBlocks = JSON.parse(msgBlocksStr);
            console.log(`Parsed message blocks from user join event ${userRecord.id}`);
        } catch (error) {
            console.error(`Error parsing message blocks for user join event ${userRecord.id}: ${error}`);
            await client.chat.postMessage({
                channel: process.env.SLACK_LOGGING_CHANNEL,
                text: `ERROR: Error parsing message blocks for user join event ${userRecord.id}: ${error}`
            });
        }
    }
    try {
        await people_airtable.update(userRecord.id, {
            [process.env.AIRTABLE_HS_SLACK_ID_FIELD_NAME]: event.user.id,
            [process.env.AIRTABLE_HS_USER_REFERRED_TO_HARBOR_FIELD_NAME]: true,
            [process.env.AIRTABLE_HS_HAS_SIGNED_IN_FIELD_NAME]: true // those square brackets are ES6 computed property names
        }, 'Arrpheus.team_join/1.0.0');
    } catch (error) {
        console.error(`Error updating user record with slack id ${event.user.id}: ${error}. attempting to fall back to jrb...`);
        fallbackUserLog(client, email, event);
        await client.chat.postMessage({
            channel: event.user.id,
            text: "Ahoy, matey! Welcome to High Seas! We be under heavy load at the moment, watch this space for a link to continue to arrive in the next few hours! If you don't get something soon, make a post in <#C07PZNMBPBN>.",
            username: 'Arrpheus',
            icon_url: 'https://noras-secret-cdn.hackclub.dev/yeah_of_course_river_np.png'}
        );
        console.log(`${event.user.id} has been notified of heavy load (on write).`);
        return;
    }
    console.log(`Updated user record with slack id ${event.user.id}`);
    // send welcome message
    await client.chat.postMessage({
        channel: event.user.id,
        text: userRecord.fields[process.env.AIRTABLE_JR_AUTH_MESSAGE_FIELD_NAME],
        blocks: msgBlocks ? msgBlocks : undefined,
        username: 'Arrpheus',
        icon_url: 'https://noras-secret-cdn.hackclub.dev/yeah_of_course_river_np.png',
    });
    // also send directly to user (not into slackbot)
    await client.chat.postMessage({
        channel: event.user.id,
        text: userRecord.fields[process.env.AIRTABLE_JR_AUTH_MESSAGE_FIELD_NAME],
        blocks: msgBlocks ? msgBlocks : undefined
    });

});

async function fallbackUserLog(client, email, event){
    try {
        const jrbRecord = await join_requests_base_airtable.read({
            filterByFormula: `{${process.env.AIRTABLE_JRB_EMAIL_FIELD_NAME}} = '${email}'`,
            maxRecords: 1
        }, 'Arrpheus.team_join/1.0.0');
        if (jrbRecord.length === 0) {
            console.error(`Error: no join request base record found for user <@${event.user.id}> with email ${email}`);
            await client.chat.postMessage({
                channel: process.env.SLACK_LOGGING_CHANNEL,
                text: `ERROR: No join request base record found for user <@${event.user.id}> with email ${email}`
            });
            return;
        }
        await join_requests_base_airtable.update(jrbRecord[0].id, {
            "Slack ID": event.user.id,
            "arrpheus_fell_back": true
        }, 'Arrpheus.team_join/1.0.0');
    } catch (error) {
        console.error(`Error falling back to join requests base: ${error}`);
    }
}

app.command('/dm-magic-link', async ({ ack, body, client }) => {
    // look up the magic link in airtable and dm the pinged user
    await ack();
    console.log(`Got command /dm-magic-link from ${body.user_id} with text ${body.text}`);
    // users allowed to use this command are workspace admins/owners, members of group S07U41270QN, and U05PYFCJXV0
    // verify that user is allowed to use this command
    let user_allowed = false;
    try {
        const result = await client.usergroups.users.list({ usergroup: 'S07U41270QN' });
        if (result.ok) {
            user_allowed = result.users.includes(body.user_id) || body.user_id === 'U05PYFCJXV0';
        }
    } catch (error) {
        console.error(`Error checking if user is allowed to use command: ${error}`);
    }
    // check if user is workspace admin
    try {
        const result = await client.users.info({ user: body.user_id });
        if (result.ok) {
            user_allowed = user_allowed || result.user.is_admin || result.user.is_owner;
        }
    } catch (error) {
        console.error(`Error checking if user is workspace admin: ${error}`);
    }

    if (!user_allowed) {
        await client.chat.postEphemeral({
            channel: body.channel_id,
            user: body.user_id,
            text: "You are not allowed to use this command."
        });
        return;
    }

    let mentionedSlackId = body.text.match(/<@([^>]+)\|.*>/) ? body.text.match(/<@([^>]+)\|.*>/)[1] : undefined;
    if (!mentionedSlackId) {
        await client.chat.postEphemeral({
            channel: body.channel_id,
            user: body.user_id,
            text: "You need to mention a user to send them a magic link."
        });
        return;
    }
    console.log(`Mentioned slack id: ${mentionedSlackId}`);
    let possibleUsers = [];
    try {
        possibleUsers = await people_airtable.read({
            filterByFormula: `AND({${process.env.AIRTABLE_HS_SLACK_ID_FIELD_NAME}} = '${mentionedSlackId}', {${process.env.AIRTABLE_JR_INVITE_REQUESTED_FIELD_NAME}})`,
            maxRecords: 1
        }, 'Arrpheus.dm-magic-link/1.0.0');
    } catch (error) {
        console.error(`Error looking up user by slack id ${mentionedSlackId}: ${error}`);
    }
    if (possibleUsers.length === 0) {
        await client.chat.postEphemeral({
            channel: body.channel_id,
            user: body.user_id,
            text: "No user found with that Slack ID who has a magic link. You should ping <@U05PYFCJXV0>, this user probably has a deeper issue."
        });
        return;
    }
    let userRecord = possibleUsers[0];
    let magicLink = userRecord.fields[process.env.AIRTABLE_JR_AUTH_MESSAGE_FIELD_NAME];
    await client.chat.postMessage({
        channel: mentionedSlackId,
        text: `${magicLink}`,
    });

    await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: `Sent magic link to <@${mentionedSlackId}>.`
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
            const userRecord = await people_airtable.read({
                filterByFormula: `{${process.env.AIRTABLE_HS_EMAIL_FIELD_NAME}} = '${userEmail}'`,
                maxRecords: 1
            }, 'Arrpheus.serv.jr/1.0.0');
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
            await people_airtable.update(result['airtableRecord'].id, result['airtableRecord'].fields, 'Arrpheus.serv.jr/1.0.0');
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
            const userRecord = await people_airtable.read({
                filterByFormula: `{${process.env.AIRTABLE_HS_SLACK_ID_FIELD_NAME}} = '${userSlackId}'`,
                maxRecords: 1
            }, 'Arrpheus.serv.promo/1.0.0');
            if (userRecord.length === 0) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('User not found in Airtable');
                return;
            }

            const result = await upgradeUser(app.client, userSlackId, CHANNELS_ON_PROMOTION);
            if (result.ok) {
                await people_airtable.update(userRecord[0].id, {
                    [process.env.AIRTABLE_HS_PROMOTED_FIELD_NAME]: true
                }, 'Arrpheus.serv.promo/1.0.0');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            } else {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            }
        });
    } else if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');

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
    setTimeout(pollAirtable, currentPollingRate);
})();
