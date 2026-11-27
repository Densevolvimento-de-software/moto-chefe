// Lojas MotoChefe (#321): quais lojas a API de leitura devolve e quais Contas podem sair com custo, despesas e meta.
import { exigirAcessoPagina } from '../components/admin-guard'
import { ROTA_LOJAS_MOTOCHEFE } from '@/lib/motochefe-marcacao'
import { listarContasMotochefe } from '@/lib/motochefe-marcacao-banco'
import { LojasMotochefe } from './components/lojas-motochefe'

export default async function LojasMotochefePage() {
  // Antes de qualquer busca (#579).
  await exigirAcessoPagina(ROTA_LOJAS_MOTOCHEFE)
  const contas = await listarContasMotochefe()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Lojas MotoChefe</h1>
        <p className="text-muted-foreground text-sm">
          Escolha uma Conta, marque as lojas e confira as autorizações. Loja desmarcada sai da API na hora.
        </p>
      </div>
      <LojasMotochefe contas={contas} />
    </div>
  )
}
