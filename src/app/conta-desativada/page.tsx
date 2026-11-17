// src/app/conta-desativada/page.tsx
//
// Destino de quem tem sessão válida no Supabase mas `usuarios.ativo = false`
// (ver getUsuarioLogado em @/lib/auth). De propósito, esta página NÃO chama
// getUsuarioLogado — ela É o redirecionamento que essa função faz, então
// chamá-la de novo aqui recairia no mesmo redirect (não é loop infinito, mas
// não serve pra nada: mostraria a mesma página de novo).
//
// Também recebe o login da fábrica sem acesso (papel do token diferente da linha, painel
// bloqueado; @/lib/login-fabrica): por isso o texto não afirma que a conta foi desativada.
//
// Sair é POST na rota de sair, não Server Action: o login da fábrica desativado também cai
// aqui, e para ele toda action é recusada; com a action ele ficava preso (#901).
import { Button } from '@/components/ui/button'
import { ROTA_SAIR } from '@/lib/login-fabrica'

export default function ContaDesativadaPage() {
  return (
    <div className="min-h-screen bg-muted flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-card rounded-lg border p-6 shadow-sm text-center space-y-4">
        <h1 className="text-xl font-bold">Acesso indisponível</h1>
        <p className="text-sm text-muted-foreground">
          Este login está desativado ou não tem acesso ao sistema agora. Se isso for um engano,
          fale com o administrador.
        </p>
        <form action={ROTA_SAIR} method="post">
          <Button type="submit" className="w-full">Sair</Button>
        </form>
      </div>
    </div>
  )
}
