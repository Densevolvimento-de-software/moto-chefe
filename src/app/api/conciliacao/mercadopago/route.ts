import { NextResponse } from 'next/server'
import { getUsuarioLogado } from '@/lib/auth'
import { usuarioPodeAcessar } from '@/lib/navegacao-servidor'
import { podeGerirConciliacao } from '@/lib/conciliacao-papeis'
import { getGrupoAtivo } from '@/lib/grupo'
import { resultadoDoGrupo } from '@/lib/mercadopago/rodada'

// Importação de minutos (2 buscas paginadas no Mercado Pago): Route Handler, não Server Action (ver useAcaoDemorada).
export const maxDuration = 300
export const dynamic = 'force-dynamic'

/**
 * Botão "Importar agora" da /conciliacao (#51): importa só o grupo ativo da sessão, pela mesma função da rotina
 * diária (a falha fica gravada para a faixa). Toda recusa e falha volta como `{ error }`, que é o que a tela lê;
 * o resultado bom também fica gravado, e a tela recarrega para mostrar.
 */
export async function POST() {
  let usuario
  try {
    usuario = await getUsuarioLogado()
  } catch {
    return NextResponse.json({ error: 'Sessão expirada' }, { status: 401 })
  }
  if (!usuarioPodeAcessar(usuario, '/conciliacao') || !podeGerirConciliacao(usuario.papel)) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }
  try {
    const grupo = await getGrupoAtivo(usuario)
    const r = await resultadoDoGrupo({ id: grupo.id, nome: grupo.nome })
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.erro }, { status: 502 })
  } catch (e) {
    // Sem a mensagem, que pode trazer detalhe de conexão; a tela lê só { error }.
    console.error('[conciliacao-mercadopago] importar pelo botão falhou', e instanceof Error ? e.name : 'erro')
    return NextResponse.json({ error: 'Não deu para importar agora. Tente de novo em alguns minutos.' }, { status: 500 })
  }
}
