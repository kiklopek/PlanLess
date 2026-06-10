// Curated voice catalog — users pick by name, never by raw ID.
// All voice IDs are public ElevenLabs library voices (free tier supported).

export const VOICE_CATALOG = [
  {
    id: 'nikola',
    label: 'Nikola',
    description: 'Přátelská a vřelá — ideální pro salóny a péči',
    gender: 'female',
    elevenlabs_voice_id: 'EXAVITQu4vr4xnSDxMaL', // Bella
  },
  {
    id: 'petra',
    label: 'Petra',
    description: 'Profesionální a klidná — pro kliniky a kanceláře',
    gender: 'female',
    elevenlabs_voice_id: 'XrExE9yKIg1WjnnlVkGX', // Matilda
  },
  {
    id: 'david',
    label: 'David',
    description: 'Mužský hlas, sebejistý a přátelský',
    gender: 'male',
    elevenlabs_voice_id: 'pNInz6obpgDQGcFmaJgB', // Adam
  },
]

export function voiceById(id) {
  return VOICE_CATALOG.find((v) => v.id === id) ?? VOICE_CATALOG[0]
}

export function elevenlabsIdFor(voiceId) {
  return voiceById(voiceId).elevenlabs_voice_id
}
