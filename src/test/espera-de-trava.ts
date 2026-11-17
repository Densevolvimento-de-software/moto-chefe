import { sql } from 'drizzle-orm'

// Para testes de banco com duas sessões: uma segura a trava e a outra tem de esperar por ela.
type Executor = { execute(q: ReturnType<typeof sql>): Promise<unknown> }

/** Quantas sessões estão esperando uma trava segurada pela sessão `pid`. */
export async function esperandoPor(exec: Executor, pid: number): Promise<number> {
  const r = (await exec.execute(sql`select pid from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))`)) as unknown as { rows: unknown[] }
  return r.rows.length
}

/** Espera a condição valer, sem relógio; falha dizendo o que não chegou. */
export async function ate(condicao: () => Promise<boolean>, oQue: string): Promise<void> {
  for (let i = 0; i < 400; i++) { if (await condicao()) return; await new Promise(r => setImmediate(r)) }
  throw new Error('não chegou: ' + oQue)
}
