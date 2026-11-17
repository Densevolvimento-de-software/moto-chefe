// Acessos da fábrica (#3): login e senha da fábrica MotoChefe, só o admin_geral.
import { exigirAcessoPagina } from '../components/admin-guard'
import { ROTA_ACESSOS_FABRICA } from '@/lib/acessos-fabrica'
import { listarAcessosFabrica } from '@/lib/queries/acessos-fabrica'
import { AcessosFabrica } from './components/acessos-fabrica'

export default async function AcessosFabricaPage() {
  // Antes de qualquer busca (#579).
  await exigirAcessoPagina(ROTA_ACESSOS_FABRICA)
  const acessos = await listarAcessosFabrica()

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold">Acessos da fábrica</h1>
        <p className="text-muted-foreground text-sm">
          Login e senha da fábrica MotoChefe. Quem entra com um destes vê só o Painel da Fábrica
          (estoque e vendas MotoChefe de todas as lojas), sem menu e sem nenhuma outra tela.
        </p>
      </div>
      <AcessosFabrica acessos={acessos} />
    </div>
  )
}
