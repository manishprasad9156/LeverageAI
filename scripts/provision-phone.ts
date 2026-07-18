/**
 * Provision ElevenLabs phone number from Twilio credentials.
 * Runs only when TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER set.
 *
 * Manual path (recommended for first setup):
 * 1. Buy Twilio local number (~$1.15/mo; trial credit works)
 * 2. ElevenLabs dashboard → Phone Numbers → Connect Twilio (SID + Auth Token)
 * 3. Assign intake agent for inbound
 *
 * Usage: npx tsx scripts/provision-phone.ts
 */
const API = "https://api.elevenlabs.io/v1";

async function main() {
  const key = process.env.ELEVENLABS_API_KEY;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const phone = process.env.TWILIO_PHONE_NUMBER;
  const agentId = process.env.ELEVENLABS_INTAKE_AGENT_ID;

  if (!key || !sid || !token || !phone) {
    console.log(
      "Skip: set ELEVENLABS_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER"
    );
    console.log(
      "Manual: ElevenLabs dashboard → Phone Numbers → connect Twilio → assign intake agent"
    );
    process.exit(0);
  }

  // Verify path against current docs if this 404s:
  // https://elevenlabs.io/docs/eleven-agents/phone-numbers
  const res = await fetch(`${API}/convai/phone-numbers`, {
    method: "POST",
    headers: {
      "xi-api-key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      phone_number: phone,
      provider: "twilio",
      label: "leverageai-inbound",
      sid,
      token,
      supports_inbound: true,
      supports_outbound: true,
    }),
  });
  const body = await res.text();
  console.log(res.status, body.slice(0, 500));
  if (agentId) {
    console.log(
      "Next: assign agent",
      agentId,
      "to this phone number in the ElevenLabs dashboard (or PATCH phone-numbers API)."
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
