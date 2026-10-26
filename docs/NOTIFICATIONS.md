# Notifications (e-mail & WhatsApp)

Customers are only notified on channels they agreed to (address book: *Notify by e-mail* /
*Notify via WhatsApp*; the time of consent is stored).

## Flow per tour

| When | Who | Message | Tracking |
|---|---|---|---|
| Driver taps **Start tour** | the first *N* open stops (Settings → Notifications, default 3) | "We are almost there" + live link | activated |
| Driver taps **Start tour** | all other stops | "Your delivery arrives today, about HH:MM–HH:MM" + link | waiting page |
| A stop is completed | stops that move into the window of *N* open stops | "We are almost there" + live link | activated |
| Optional after an outcome | that customer | delivered / not delivered | result |
| Any time | one stop or all open stops (back office, app) | manual update | – |

Automatic messages are sent at most once per stop, kind and channel. A worker retries failed
messages up to 5 times (`NOTIFY_WORKER_INTERVAL_MS`). Every message is listed in the tour's
*Messages* tab with status and error.

Templates (subject + text per language) are editable under **Settings → Notifications**.
Placeholders: `{{customer_name}} {{company}} {{eta}} {{eta_window}} {{date}} {{tracking_link}}
{{stops_ahead}} {{order_numbers}} {{driver_name}}`. The customer's language decides the template.

## E-mail (SMTP)

Any SMTP provider works: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.
For development start Mailpit (`docker compose --profile dev up -d`, `SMTP_HOST=mailpit`,
`SMTP_PORT=1025`) and open <http://localhost:8025>.

## WhatsApp

`WHATSAPP_PROVIDER` selects the adapter. Messages a business sends first need a **template that
WhatsApp approved**. All templates get three body variables:
`{{1}}` customer name, `{{2}}` ETA (time window for day start), `{{3}}` tracking link.

### Meta WhatsApp Cloud API (`meta`)

1. Create a WhatsApp Business app in the Meta developer portal, add a phone number.
2. `WHATSAPP_META_TOKEN` (permanent system-user token), `WHATSAPP_META_PHONE_NUMBER_ID`.
3. Create templates (category *Utility*), e.g. `delivery_approaching`:
   *"Hello {{1}}, our driver is on the way, expected around {{2}}. Track live: {{3}}"*
4. `WHATSAPP_META_TEMPLATE_APPROACHING=delivery_approaching` (likewise `_DAY_START`, `_MANUAL`,
   `_DELIVERED`, `_FAILED`). The template language is the customer's language (`de` / `en`).

Without a template variable the text template from the settings is sent as a normal message,
which WhatsApp only delivers within 24 h after the customer wrote to you.

### Twilio (`twilio`)

`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` (+E.164 sender) and per kind a
content template `TWILIO_CONTENT_SID_<KIND>` with the variables 1–3.

### Testing

`WHATSAPP_PROVIDER=log` prints messages to the backend log. **Settings → Notifications → Test
message** sends a test via the configured provider.
