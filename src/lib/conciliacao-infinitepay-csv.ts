// Leitor do relatório CSV da InfinitePay (cartão). Função pura: recebe o texto já decodificado e
// devolve as linhas aprovadas. Sem banco, sem rede, sem data atual.
//
// Colunas (por posição): 0 Data e hora, 1 Meio, 2 Bandeira, 3 Parcelas, 5 Dados adicionais (serial),
// 6 Identificador, 7 Status, 8 Valor, 9 Líquido, 13 NSU, 14 Origem - Nome.
import { extrairTerminalInfinityPay } from '@/lib/conciliacao-terminal'

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQuotes = !inQuotes }
    else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = '' }
    else { current += ch }
  }
  result.push(current.trim())
  return result
}

export function parseBRL(s: string): number {
  return parseFloat(s.replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, '')) || 0
}

export function parseInfinityPay(text: string) {
  const lines = text.trim().split(/\r?\n/)
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const c = parseCSVLine(lines[i])
    // c[7] = Status, c[1] = Meio
    if (c[7] !== 'Aprovada') continue
    if (!['Crédito', 'Débito'].includes(c[1])) continue

    const [dd, mm, yyyy] = (c[0].split(' ')[0]).split('/')
    rows.push({
      dataTransacao: `${yyyy}-${mm}-${dd}`,
      tipo:          c[1] === 'Débito' ? 'debito' as const : 'credito' as const,
      bandeira:      c[2],
      parcelas:      c[3] === 'À Vista' ? 1 : (parseInt(c[3], 10) || 1),
      autorizacao:   c[6] !== '000000' ? c[6] : null,
      valorBruto:    parseBRL(c[8]),
      valorLiquido:  parseBRL(c[9]),
      nsu:           c[13] || null,
      portador:      c[14] || null,
      terminal:      extrairTerminalInfinityPay(c[5]),
    })
  }
  return rows
}
