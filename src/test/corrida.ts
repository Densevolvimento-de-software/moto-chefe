// Teste de corrida no Postgres descartável: uma sessão à parte segura linhas numa transação aberta e diz quem
// está esperando por ela, para o teste pôr os pedidos numa ordem certa em vez de depender do tempo.
import pg from 'pg'

/** Espera a condição virar verdade; senão falha dizendo o que não aconteceu. */
export async function ate(condicao: () => Promise<boolean>, oQue: string) {
  for (let i = 0; i < 400; i++) { if (await condicao()) return; await new Promise(r => setImmediate(r)) }
  throw new Error('não chegou: ' + oQue)
}

/** Abre uma sessão com a transação aberta. `soltar` faz o commit; `fim` fecha a conexão (chame no finally). */
export async function sessaoQueSegura(url: string) {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  await c.query('begin')
  const pid = (await c.query('select pg_backend_pid() p')).rows[0].p as number
  return {
    pid,
    travar: (sqlTexto: string, params: unknown[]) => c.query(sqlTexto, params),
    /** Sessões esperando lock por causa de uma das sessões dadas. */
    // Dentro da transação aberta, pg_stat_activity congela na 1ª leitura: limpa o snapshot antes de cada consulta.
    esperandoPor: async (pids: number[]) => {
      await c.query('select pg_stat_clear_snapshot()')
      return (await c.query('select pid from pg_stat_activity where pg_blocking_pids(pid) && $1::int[]', [pids])).rows.map(r => Number(r.pid))
    },
    soltar: () => c.query('commit'),
    fim: () => c.end(),
  }
}
