// Endereço antigo do impresso do painel (#901): leva ao novo, com a aba, o filtro e o período.
import { redirect } from 'next/navigation'
import { abaDaUrl, filtroDaUrl, periodoDoPainel, urlDoFiltro, ROTA_PAINEL_FABRICA, type ParamsPainel } from '@/lib/painel-fabrica'

export default async function PainelFabricaImprimirAntigoPage({ searchParams }: { searchParams: Promise<ParamsPainel> }) {
  const params = await searchParams
  const { de, ate } = periodoDoPainel(params)
  redirect(`${ROTA_PAINEL_FABRICA}/imprimir?${urlDoFiltro(filtroDaUrl(params), de, ate, abaDaUrl(params.aba))}`)
}
