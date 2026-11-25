import { ehLojaDoPainel, ehMarcaDoPainel, type LojaParaPainel } from '@/lib/painel-fabrica'

/**
 * O certificado de bateria (MAPFRE) é só da moto MotoChefe vendida por loja MotoChefe: a mesma regra do
 * painel da fábrica, sem cadastro novo (#235). Tela, link e página decidem por esta função.
 */
export function temCertificadoBateria(venda: { marca: string | null | undefined; loja: LojaParaPainel }): boolean {
  return ehMarcaDoPainel(venda.marca) && ehLojaDoPainel(venda.loja)
}
