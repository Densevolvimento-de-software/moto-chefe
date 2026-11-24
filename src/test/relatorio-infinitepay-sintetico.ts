// Relatório da InfinitePay SINTÉTICO: mesma estrutura do arquivo real (cabeçalho na 1ª linha, 15
// colunas, separador ","; o cartão e o PIX saem em relatórios separados, com o mesmo cabeçalho), com
// valores, NSU, identificador, serial e nome inventados. O arquivo real de cliente nunca entra no repo.

export const CABECALHO_INFINITEPAY = [
  'Data e hora', 'Meio - Meio', 'Meio - Bandeira', 'Meio - Parcelas', 'Tipo - Origem',
  'Tipo - Dados adicionais', 'Identificador', 'Status', 'Valor (R$)', 'Líquido (R$)',
  'Taxa Aplicada - Valor(R$)', 'Taxa Aplicada - Aplicada(%)', 'Plano', 'NSU', 'Origem - Nome',
]

export type LinhaInfinitePay = Record<string, string>

const CARTAO: LinhaInfinitePay = {
  'Data e hora': '10/11/2026 14:05', 'Meio - Meio': 'Crédito', 'Meio - Bandeira': 'Visa',
  'Meio - Parcelas': 'À Vista', 'Tipo - Origem': 'Maquininha', 'Tipo - Dados adicionais': 'NS: TESTE000000001',
  'Identificador': '000000', 'Status': 'Aprovada', 'Valor (R$)': '100,00', 'Líquido (R$)': '97,00',
  'Taxa Aplicada - Valor(R$)': '3,00', 'Taxa Aplicada - Aplicada(%)': '3,00', 'Plano': 'Padrão',
  'NSU': 'STESTE00000000120261110140500001', 'Origem - Nome': 'CLIENTE FICTICIO UM',
}

const PIX: LinhaInfinitePay = {
  ...CARTAO, 'Meio - Meio': 'Pix', 'Meio - Bandeira': 'Pix', 'Líquido (R$)': '100,00',
  'Identificador': 'a1b2c3d4e5f60718293a4b5c6d7e8f90', 'Taxa Aplicada - Valor(R$)': '0,00',
  'Taxa Aplicada - Aplicada(%)': '0,00', 'Plano': 'Outro', 'NSU': '7000000001', 'Origem - Nome': 'PAGADOR FICTICIO DOIS',
}

/** Linha de cartão: tudo do padrão, trocando só o que o cenário quer mudar. */
export const cartaoInfinitePay = (mudancas: LinhaInfinitePay = {}): LinhaInfinitePay => ({ ...CARTAO, ...mudancas })

/** Linha de PIX, como sai do relatório separado de PIX. */
export const pixInfinitePay = (mudancas: LinhaInfinitePay = {}): LinhaInfinitePay => ({ ...PIX, ...mudancas })

// Valor com vírgula decimal vem entre aspas, como no arquivo real.
const celula = (texto: string) => (texto.includes(',') ? `"${texto}"` : texto)

export function montarRelatorioInfinitePay(linhas: LinhaInfinitePay[]): string {
  const cabecalho = CABECALHO_INFINITEPAY.join(',')
  return [cabecalho, ...linhas.map(l => CABECALHO_INFINITEPAY.map(nome => celula(l[nome] ?? '')).join(',')), ''].join('\n')
}
