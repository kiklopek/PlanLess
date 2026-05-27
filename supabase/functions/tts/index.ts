/**
 * ElevenLabs TTS proxy — streams audio/mpeg to Twilio <Play>.
 *
 * IMPORTANT: This function must be set to "no JWT verification" in Supabase Dashboard
 * (Edge Functions → tts → toggle off "Require JWT") so Twilio can call it directly.
 *
 * GET /functions/v1/tts?t=<encoded_text>&v=<voice_id>
 */

const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL' // Bella — good Czech quality

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } })
  }

  const url = new URL(req.url)
  const text = url.searchParams.get('t') ?? ''
  const voiceId = url.searchParams.get('v') || DEFAULT_VOICE_ID

  if (!text) return new Response('Missing text', { status: 400 })

  const apiKey = Deno.env.get('ELEVENLABS_API_KEY') ?? ''
  if (!apiKey) return new Response('ElevenLabs not configured', { status: 503 })

  const resp = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    },
  )

  if (!resp.ok) {
    const err = await resp.text()
    console.error('ElevenLabs error:', resp.status, err)
    return new Response('TTS upstream error', { status: 502 })
  }

  return new Response(resp.body, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  })
})
