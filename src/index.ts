import { App } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { AirtablePlus } from 'airtable-plus';
require('dotenv').config();

const envVarsUsed = ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", 
    "AIRTABLE_BASE_ID", "AIRTABLE_API_KEY", "AIRTABLE_TABLE_NAME", 
    "AIRTABLE_INVITE_REQUESTED_FIELD_NAME", "AIRTABLE_INVITE_SENT_FIELD_NAME", 
    "AIRTABLE_GRADUATED_FIELD_NAME", "AIRTABLE_PROMOTED_FIELD_NAME", 
    "AIRTABLE_EMAIL_FIELD_NAME", "AIRTABLE_SLACK_ID_FIELD_NAME",
    "AIRTABLE_HAS_SIGNED_IN_FIELD_NAME",
    "SLACK_WELCOME_MESSAGE", "SLACK_LOGGING_CHANNEL"];
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

const airtable = new AirtablePlus({
    baseID: process.env.AIRTABLE_BASE_ID!,
    apiKey: process.env.AIRTABLE_API_KEY!,
    tableName: process.env.AIRTABLE_TABLE_NAME!
    });

function pollAirtable() {
    console.log('Polling airtable');
    airtable.read({
        filterByFormula: `AND({${process.env.AIRTABLE_INVITE_REQUESTED_FIELD_NAME}}, NOT({${process.env.AIRTABLE_INVITE_SENT_FIELD_NAME}})`,
        maxRecords: 1,
        sort: [{field: 'createdTime', direction: 'asc'}]
    }).then(records => {
        if (records.length > 0) {
            console.log('Inviting new user');
            // invite new user
        }
    });
    airtable.read({
        filterByFormula: `AND({${process.env.AIRTABLE_GRADUATED_FIELD_NAME}}, NOT({${process.env.AIRTABLE_PROMOTED_FIELD_NAME}})`,
        maxRecords: 1,
        sort: [{field: 'createdTime', direction: 'asc'}]
    }).then(records => {
        if (records.length > 0) {
            console.log('Promoting user');
            // promote user
        }
    });
}

// welcomes new users
app.event('team_join', async ({ event, client }) => {
    return; // don't actually do this for now
    await client.chat.postMessage({
        channel: event.user.id,
        text: process.env.SLACK_WELCOME_MESSAGE
    });
    // find airtable record by email and update it w/ slack id
    const email = event.user.profile.email;
    if (!email) {
        const errorString = `ERROR: When welcoming user, no email found for user <@${event.user.id}>`;
        console.error(errorString);
        await client.chat.postMessage({
            channel: process.env.SLACK_LOGGING_CHANNEL,
            text: errorString
        });
        return;
    }
    const userRecords = await airtable.read({
        filterByFormula: `{${process.env.AIRTABLE_EMAIL_FIELD_NAME}} = '${email}'`
    });
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
    await airtable.update(userRecord.id, {
        [process.env.AIRTABLE_SLACK_ID_FIELD_NAME]: event.user.id,
        [process.env.AIRTABLE_HAS_SIGNED_IN]: true // those square brackets are ES6 computed property names
    });

});
// TODO:
// - test team_join event
// - actually poll airtable
// - implement user invitation and promotion

// Start the app
(async () => {
  await app.start();
  console.log('⚡️ Bolt app is running!');
  await app.client.chat.postMessage({
    channel: process.env.SLACK_LOGGING_CHANNEL,
    text: 'INFO: Bot has just started!'
  });
})();
