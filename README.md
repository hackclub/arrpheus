## Airtable impact
The Airtable rate limit impact depends on the polling rate and the rate at which users are joining the Slack. I'll call these values `polling_rate` and `join_rate` respectively, both in Hertz.

The worst-case request rate is `6 * polling_rate + 2 * join_rate` requests per second. This occurs when there are pending messages, invites, and promotions, AND there's a significant number of joins.

Per poll, Arrpheus can send 10 messages, invite 10 people, and promote 1 person.

The Message, Join, and Promotion Requests each have an impact of `polling_rate` when there are none of that request and `polling_rate * 2` when there's at least 1 of that request.

Also, for each person that joins the Slack, there's 2 requests sent.

## Airtable impact reduction
If Airtable load is coming from a high number of join/message/promotion requests, the impact can be reduced by decreasing the polling rate. This will reduce the number of requests sent at the tradeoff of increased time for Arrpheus to fulfill requests.

If Airtable load is coming from a high number of joins, things are harder. Joins are indirectly limited by the how quickly Arrpheus can send join requests (`10*polling_rate` max) so they can be reduced by reducing the polling rate. However, there's no perfect solution here - we need to track joins and log them to the DB, so we're a bit stuck.

## Theoretical impact improvement strategies
There are two ways I can see to reduce the worse-case request rate, but both would require significant architectural changes.
1. Combine Promotion and Join requests into one set of requests. Would reduce worst-case request rate to `4 * polling_rate + 2 * join_rate`.
2. Batch user join event reads and updates. Would reduce worst-case request rate to `6 * polling_rate + join_rate/5`.

## .env
Too much is here, the secrets are `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_BROWSER_TOKEN`, `SLACK_COOKIE`, and `AIRTABLE_API_KEY`.

here's the non-secret parts:
```
AIRTABLE_HS_BASE_ID=appTeNFYcUiYfGcR6
AIRTABLE_HS_TABLE_NAME=tblfTzYVqvDJlIYUB
AIRTABLE_HS_INVITE_REQUESTED_FIELD_NAME=slack_invite_requested
AIRTABLE_HS_INVITE_SENT_FIELD_NAME=slack_invite_sent
AIRTABLE_HS_HAS_SIGNED_IN_FIELD_NAME=slack_has_signed_in
AIRTABLE_HS_USER_REFERRED_TO_HARBOR_FIELD_NAME=user_referred_to_harbor
AIRTABLE_HS_PROMOTION_REQUESTED_FIELD_NAME=slack_promotion_requested
AIRTABLE_HS_PROMOTED_FIELD_NAME=slack_has_been_promoted
AIRTABLE_HS_EMAIL_FIELD_NAME=email
AIRTABLE_HS_SLACK_ID_FIELD_NAME=slack_id
AIRTABLE_HS_PROMOTE_FAILED_FIELD_NAME=slack_promotion_failed
AIRTABLE_HS_PROMOTE_FAILURE_REASON_FIELD_NAME=slack_promotion_failure_reason
AIRTABLE_JR_INVITED_FIELD_NAME=arrpheus_slack_invite_sent
AIRTABLE_JR_UNINVITABLE_FIELD_NAME=arrpheus_slack_invite_failed
AIRTABLE_JR_INVITE_FAILURE_REASON_FIELD_NAME=arrpheus_slack_invite_fail_reason
AIRTABLE_JR_DUPE_EMAIL_FIELD_NAME=slack_email_is_duplicate
AIRTABLE_JR_INVITE_REQUESTED_FIELD_NAME=arrpheus_ready_to_invite
AIRTABLE_JR_AUTH_TOKEN_FIELD_NAME=magic_auth_token
AIRTABLE_JR_AUTH_MESSAGE_FIELD_NAME=magic_auth_message
AIRTABLE_JR_FIRST_NAME_FIELD_NAME=first_name
AIRTABLE_JR_LAST_NAME_FIELD_NAME=last_name
AIRTABLE_JR_IP_ADDR_FIELD_NAME=ip_address
AIRTABLE_JR_AUTH_MESSAGE_BLOCKS_FIELD_NAME=magic_auth_message_blocks
AIRTABLE_JRB_BASE_ID=appaqcJtn33vb59Au
AIRTABLE_JRB_TABLE_NAME=tblQORJfOQcm4CoWn
AIRTABLE_JRB_FIRST_NAME_FIELD_NAME=First Name
AIRTABLE_JRB_LAST_NAME_FIELD_NAME=Last Name
AIRTABLE_JRB_EMAIL_FIELD_NAME=Email
AIRTABLE_JRB_IP_ADDR_FIELD_NAME=Form Submission IP
AIRTABLE_MR_TABLE_NAME=arrpheus_message_requests
AIRTABLE_MR_REQUESTER_FIELD_NAME=requester_identifier
AIRTABLE_MR_TARGET_FIELD_NAME=target_slack_id
AIRTABLE_MR_MSG_TEXT_FIELD_NAME=message_text
AIRTABLE_MR_MSG_BLOCKS_FIELD_NAME=message_blocks
AIRTABLE_MR_SEND_SUCCESS_FIELD_NAME=send_success
AIRTABLE_MR_SEND_FAILURE_FIELD_NAME=send_failure
AIRTABLE_MR_FAILURE_REASON_FIELD_NAME=failure_reason
AIRTABLE_MR_AUTONUMBER_FIELD_NAME=autonumber
AIRTABLE_MR_UNFURL_LINKS_FIELD_NAME=unfurl_links
AIRTABLE_MR_UNFURL_MEDIA_FIELD_NAME=unfurl_media
AIRTABLE_CONFIG_TABLE_NAME=tblCWOiZjjgJ9L3U3
AIRTABLE_CONFIG_JOIN_CHANNELS_FIELD_NAME=slack_channels_on_user_join
AIRTABLE_CONFIG_PROMOTION_CHANNELS_FIELD_NAME=slack_channels_on_user_promotion
SLACK_LOGGING_CHANNEL=C07PKNNH02C
PORT=3123
AIRTABLE_POLLING_RATE_MS=5000
```