// Endereço antigo do painel (#901): o favorito leva à área nova, com a aba, o filtro e o período.
import { redirect } from 'next/navigation'
import { abaDaUrl, filtroDaUrl, periodoDoPainel, urlDoFiltro, ROTA_PAINEL_FABRICA, type ParamsPainel } from '@/lib/painel-fabrica'

export default async function PainelFabricaAntigoPage({ searchParams }: { searchParams: Promise<ParamsPainel> }) {
  const params = await searchParams
  const { de, ate } = periodoDoPainel(params)
  redirect(`${ROTA_PAINEL_FABRICA}?${urlDoFiltro(filtroDaUrl(params), de, ate, abaDaUrl(params.aba))}`)
}
