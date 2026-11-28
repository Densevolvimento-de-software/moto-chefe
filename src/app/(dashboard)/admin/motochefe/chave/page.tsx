// Chave da API MotoChefe Brasil (#322): gerar, trocar e revogar. Só o admin_geral; o acesso é checado antes de qualquer leitura.
import { exigirAcessoPagina } from '../../components/admin-guard'
import { ROTA_CHAVE_MOTOCHEFE } from '@/lib/motochefe-marcacao'
import { lerSituacaoDaChave } from '@/lib/queries/api-leitura'
import { ChaveDaApi } from './components/chave-da-api'

export default async function ChaveMotochefePage() {
  // Antes de qualquer busca (#579).
  await exigirAcessoPagina(ROTA_CHAVE_MOTOCHEFE)
  const agora = new Date()
  const situacao = await lerSituacaoDaChave(agora)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Chave da API</h1>
        <p className="text-muted-foreground text-sm">A chave é a única entrada da API. Quem a tem lê os dados das lojas marcadas.</p>
      </div>
      <ChaveDaApi situacao={situacao} agora={agora} />
    </div>
  )
}
