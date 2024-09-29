// Invite an email to Slack. Uses an undocumented Slack API endpoint.
// Adapted from https://github.com/hackclub/arcadius/blob/main/src/functions/slack/inviteUser.ts

const blog = console.log;

async function inviteGuestToSlackToriel({ email, channels }) {
    // This is an undocumented API method found in https://github.com/ErikKalkoken/slackApiDoc/pull/70
  // Unlike the documention in that PR, we're driving it not with a legacy token but a browser storage+cookie pair

  // The SLACK_COOKIE is a xoxd-* token found in browser cookies under the key 'd'
  // The SLACK_BROWSER_TOKEN is a xoxc-* token found in browser local storage using this script: https://gist.github.com/maxwofford/5779ea072a5485ae3b324f03bc5738e1

  // I haven't yet found out how to add custom messages, so those are ignored for now
  const cookieValue = `d=${process.env.SLACK_COOKIE}`

  // Create a new Headers object
  const headers = new Headers()

  // Add the cookie to the headers
  headers.append('Cookie', cookieValue)
  headers.append('Content-Type', 'application/json')
  headers.append('Authorization', `Bearer ${process.env.SLACK_BROWSER_TOKEN}`)

  const data = JSON.stringify({
    token: process.env.SLACK_BROWSER_TOKEN,
    invites: [
      {
        email,
        type: 'restricted',
        mode: 'manual',
      },
    ],
    restricted: true,
    channels: channels.join(','),
  })

  const r = await fetch(`https://slack.com/api/users.admin.inviteBulk`, {
    headers,
    method: 'POST',
    body: data,
  })
  console.log("Got response:")
  console.log(r)
  console.log("Response JSON:")
  const j = await r.json()
  console.log(j)
  if (!j.ok) {
    throw new Error(`Slack API general error: ${j.error}`)
  }
  if (!j["invites"] || j["invites"].length === 0) {
    throw new Error(`Slack API error: successful but no invites`)
  }
  if (!j["invites"][0]["ok"]) {
    throw new Error(`Slack API error on invite: ${j["invites"][0]["error"]}`)
  }
  return { ok: true }
}

let channels = [
    "C07P1245TL7" // #thingy-test, to become #high-seas-welcome
];

let csvChannels = channels.join(",");

export async function inviteSlackUser({ email }) {
    try {
        console.log(`Inviting ${email} to Slack...`);
        const result = await inviteGuestToSlackToriel({ email, channels })
        console.log(`Invited ${email} to Slack!`);
        blog(`Invited ${email} to Slack!`, "info");
        return { ok: result["ok"] };

    } catch (e) {
        blog(`Error in inviteSlackUser: ${e}`, "error");
        return { ok: false, error: e.message };
    }
}