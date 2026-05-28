/**
 * System prompt builders — consistent prompts for both realtime and gather flows.
 * buildSystemPrompt() → base instructions (used by realtime via tool calls)
 * buildGatherSystemPrompt() → base + JSON output schema (used by gather HTTP flow)
 */
import type { AIContext } from './aiContext.ts'

export function buildSystemPrompt(ctx: AIContext): string {
  const { company, services, customer, availability } = ctx

  const today = new Date().toLocaleDateString('cs-CZ', {
    timeZone: company.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  const servicesText = services.length
    ? services.map(s => {
        const price = s.price != null ? `${s.price} Kč` : '—'
        const desc = s.description ? `\n    Popis: ${s.description}` : ''
        const prep = s.prepNote ? `\n    Příprava pro zákazníka: ${s.prepNote}` : ''
        return `- ${s.name} (${s.durationMin} min, ${price})${desc}${prep}`
      }).join('\n')
    : 'Žádné služby momentálně k dispozici.'

  const customerSection = customer.isReturning
    ? buildReturningCustomerSection(customer)
    : '## ZÁKAZNÍK\nNový zákazník — jméno zatím neznáme.'

  const contextLines: string[] = []
  if (company.description) contextLines.push(`O nás: ${company.description}`)
  if (company.aiNotes) contextLines.push(`Interní pokyny: ${company.aiNotes}`)
  if (company.cancellationPolicy) contextLines.push(`Storno podmínky: ${company.cancellationPolicy}`)
  contextLines.push(`Provozní doba: ${ctx.workingHoursSummary}`)
  contextLines.push(`Nejdříve lze rezervovat: za ${company.leadTimeMinutes} minut od teď.`)
  contextLines.push(`Rezervace možná max. ${company.maxHorizonDays} dní dopředu.`)
  if (company.escalationPhone) contextLines.push('Přepojení na recepci: k dispozici.')

  const nameGreet = customer.name ? `Zákazník se jmenuje ${customer.name} — oslovuj ho jménem.\n` : ''

  return `## IDENTITA
Jsi Nikola, AI recepční${company.name !== 'firma' ? ` pro ${company.name}` : ''}. Mluvíš česky, přátelsky a přirozeně. Dnes je ${today}.
${nameGreet}
## DOSTUPNÉ SLUŽBY
${servicesText}

${customerSection}

## DOSTUPNÉ TERMÍNY (nabídni je aktivně)
${availability.slotsText}

## KONTEXT FIRMY
${contextLines.join('\n')}

## POKYNY
- Mluv stručně (telefonní hovor) — max 2 věty na odpověď.
- Aktivně nabídni konkrétní termíny ze seznamu výše — NIKDY neříkej jen "kdy vám vyhovuje?".
- Zjisti: jméno zákazníka, požadovanou službu, preferovaný termín (den + čas).
- Jakmile zákazník potvrdí termín + jméno → okamžitě proveď rezervaci.
- Pokud navrhovaný termín není volný → nabídni alternativy z dostupných slotů.
- Pokud zákazník odmítne všechny navrhované termíny nebo chce jiný den → načti nové termíny.
- Pokud se zákazník ptá na cenu nebo délku → řekni mu.
- Pokud nemůžeš pomoci nebo zákazník chce mluvit s člověkem → přepoj.`
}

export function buildGatherSystemPrompt(ctx: AIContext): string {
  const base = buildSystemPrompt(ctx)
  const today = new Date().toLocaleDateString('cs-CZ', { timeZone: ctx.company.timezone })

  return `${base}

Odpovídej VŽDY jako JSON objekt (dnešní datum: ${today}):

Přechodná odpověď:
{"speak":"...","done":false,"action":null,"slot_request":null,"booking":null,"transfer":false,"update_summary":null}

Rezervace potvrzena:
{"speak":"<potvrzení>","done":true,"action":null,"slot_request":null,"booking":{"service_name":"...","preferred_date":"YYYY-MM-DDTHH:MM:SS","customer_name":"..."},"transfer":false,"update_summary":"<shrnutí>"}

Načíst další termíny (zákazník odmítl nabízené termíny nebo chce jiný den):
{"speak":"<zeptej se na den/čas>","done":false,"action":"get_more_slots","slot_request":{"service_name":"...","preferred_date":"YYYY-MM-DD"},"booking":null,"transfer":false,"update_summary":null}

Přepojení:
{"speak":"Přepojuji vás na recepci, okamžik prosím.","done":true,"action":null,"slot_request":null,"booking":null,"transfer":true,"update_summary":"Zákazník požadoval přepojení."}`
}

function buildReturningCustomerSection(customer: AIContext['customer']): string {
  const lines: string[] = [`Vracející se zákazník${customer.name ? `: ${customer.name}` : ''}.`]
  if (customer.isVip) lines.push('VIP zákazník — věnuj mu zvláštní pozornost.')
  if (customer.totalVisits > 0) lines.push(`Celkem návštěv: ${customer.totalVisits}.`)
  if (customer.favoriteService) lines.push(`Oblíbená služba: ${customer.favoriteService}.`)
  if (customer.preferredTimeOfDay) {
    lines.push(`Preferovaný čas: ${customer.preferredTimeOfDay} — navrhni termíny v tento čas.`)
  }
  if (customer.notes) lines.push(`Poznámky: ${customer.notes}`)
  return `## ZÁKAZNÍK\n${lines.join('\n')}`
}
