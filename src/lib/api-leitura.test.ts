import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CARENCIA_MS, LIMITE_POR_MINUTO, chaveAceita, corpoDoErro, ehCorridaDeTroca,
  fraseDoErroDaChave, FRASE_ERRO_GERAR, janelaDoMinuto, linhaDaLoja, linhaDoAcesso, passouDoLimite, planoDaTroca, respostaDeLimite,
  statusDoErro, tipoDoLogDaTroca, type LojaDaApi,
} from './api-leitura'

const AGORA = new Date('2026-11-27T12:00:00Z')
const emMs = (ms: number) => new Date(AGORA.getTime() + ms)

test('chave atual (sem validade e sem revogação) é aceita', () => {
  assert.equal(chaveAceita({ validaAte: null, revogadaEm: null }, AGORA), true)
})

test('chave revogada não é aceita, mesmo com validade futura', () => {
  assert.equal(chaveAceita({ validaAte: emMs(CARENCIA_MS), revogadaEm: AGORA }, AGORA), false)
})

test('chave com validade passada não é aceita; com validade futura é aceita até o instante da validade', () => {
  assert.equal(chaveAceita({ validaAte: emMs(-1), revogadaEm: null }, AGORA), false)
  assert.equal(chaveAceita({ validaAte: emMs(1), revogadaEm: null }, AGORA), true)
  assert.equal(chaveAceita({ validaAte: emMs(0), revogadaEm: null }, AGORA), false)
})

test('troca: a chave atual entra em carência de 24 horas e nada é revogado', () => {
  const plano = planoDaTroca([{ id: 'a', hash: 'h', validaAte: null, revogadaEm: null }], AGORA)
  assert.deepEqual(plano, { revogar: [], expirar: [{ id: 'a', validaAte: emMs(CARENCIA_MS) }] })
})

test('troca: chave já em carência é revogada na hora, e a atual entra em carência', () => {
  const plano = planoDaTroca([
    { id: 'antiga', hash: 'h1', validaAte: emMs(1000), revogadaEm: null },
    { id: 'atual', hash: 'h2', validaAte: null, revogadaEm: null },
  ], AGORA)
  assert.deepEqual(plano, { revogar: ['antiga'], expirar: [{ id: 'atual', validaAte: emMs(CARENCIA_MS) }] })
})

test('troca: chave vencida e ainda não revogada também sai (revogar)', () => {
  const plano = planoDaTroca([{ id: 'v', hash: 'h', validaAte: emMs(-1000), revogadaEm: null }], AGORA)
  assert.deepEqual(plano, { revogar: ['v'], expirar: [] })
})

test('linha da loja sai só com as seis colunas da spec, mesmo que o objeto traga mais campos', () => {
  const doBanco = {
    id: 'l1', nome: 'Loja 1', cidade: 'Belo Horizonte', endereco: 'Rua 1', cep: '30140071', ativa: true,
    grupoId: 'g1', lojaMotochefe: true, fabricaEmail: 'x@y.invalid',
  } as LojaDaApi
  const linha = linhaDaLoja(doBanco)
  assert.deepEqual(linha, { id: 'l1', nome: 'Loja 1', cidade: 'Belo Horizonte', endereco: 'Rua 1', cep: '30140071', ativa: true })
  assert.deepEqual(Object.keys(linha).sort(), ['ativa', 'cep', 'cidade', 'endereco', 'id', 'nome'])
})

test('erros têm código e frase numa lista só; acesso negado é 401 e erro interno é 500', () => {
  assert.deepEqual(corpoDoErro('acesso_negado'), { codigo: 'acesso_negado', frase: 'Acesso negado.' })
  assert.deepEqual(corpoDoErro('erro_interno'), { codigo: 'erro_interno', frase: 'Erro interno.' })
  assert.equal(statusDoErro('acesso_negado'), 401)
  assert.equal(statusDoErro('erro_interno'), 500)
  assert.equal(statusDoErro('limite_atingido'), 429)
})

test('janela: cada instante cai em uma só janela, e a virada acontece na fronteira', () => {
  assert.equal(janelaDoMinuto(new Date('2026-11-27T12:00:59.999Z')).toISOString(), '2026-11-27T12:00:00.000Z')
  assert.equal(janelaDoMinuto(new Date('2026-11-27T12:01:00.000Z')).toISOString(), '2026-11-27T12:01:00.000Z')
})

test('passa do teto só a partir do pedido seguinte a ele', () => {
  assert.equal(passouDoLimite(LIMITE_POR_MINUTO), false)
  assert.equal(passouDoLimite(LIMITE_POR_MINUTO + 1), true)
})

test('limite atingido: 429 com frase fixa, sem número de pedidos nem da chave; Retry-After são os segundos até a janela seguinte', () => {
  const resposta = respostaDeLimite(new Date('2026-11-27T12:00:30.000Z'))
  assert.equal(resposta.status, 429)
  assert.deepEqual(resposta.corpo, { codigo: 'limite_atingido', frase: 'Limite de chamadas atingido.' })
  assert.deepEqual(resposta.cabecalhos, { 'Retry-After': '30' })
})

test('Retry-After: segundos até a janela seguinte, do início ao último instante da janela', () => {
  assert.deepEqual(respostaDeLimite(new Date('2026-11-27T12:00:00.000Z')).cabecalhos, { 'Retry-After': '60' })
  assert.deepEqual(respostaDeLimite(new Date('2026-11-27T12:00:59.999Z')).cabecalhos, { 'Retry-After': '1' })
})

test('linha do registro sai só com as colunas da tabela; token, Authorization e corpo do pedido nunca entram', () => {
  const pedido = {
    chaveId: null, endpoint: '/api/v1/lojas', status: 401,
    origem: { ip: '200.1.2.3', userAgent: 'agente-de-teste' },
    periodo: null, pagina: null, linhas: null,
    authorization: 'Bearer segredo-que-nao-pode-sair', corpo: 'trecho do pedido',
  }
  const linha = linhaDoAcesso(pedido)
  assert.deepEqual(linha, {
    chaveId: null, endpoint: '/api/v1/lojas', status: 401, ip: '200.1.2.3', userAgent: 'agente-de-teste',
    periodoIni: null, periodoFim: null, pagina: null, linhas: null,
  })
  assert.equal(JSON.stringify(linha).includes('segredo-que-nao-pode-sair'), false)
})

test('linha do registro com período e página: o período sai em ini e fim', () => {
  const linha = linhaDoAcesso({
    chaveId: 'k1', endpoint: '/api/v1/vendas', status: 200, origem: { ip: null, userAgent: null },
    periodo: { ini: '2026-01-01', fim: '2026-03-31' }, pagina: 2, linhas: 500,
  })
  assert.equal(linha.periodoIni, '2026-01-01')
  assert.equal(linha.periodoFim, '2026-03-31')
  assert.equal(linha.pagina, 2)
  assert.equal(linha.linhas, 500)
})

test('IP longo é cortado na linha do registro: IPv6 inteiro cabe em 45 caracteres; IP curto fica como veio', () => {
  const ipLongo = `${'1'.repeat(60)}`
  const doIpLongo = linhaDoAcesso({ chaveId: null, endpoint: '/api/v1/lojas', status: 401, origem: { ip: ipLongo, userAgent: null } })
  assert.equal(doIpLongo.ip, ipLongo.slice(0, 45))
  const doIpCurto = linhaDoAcesso({ chaveId: null, endpoint: '/api/v1/lojas', status: 401, origem: { ip: '200.1.2.3', userAgent: null } })
  assert.equal(doIpCurto.ip, '200.1.2.3')
})

// Chave da tela (#322): a corrida só tem frase própria quando o índice da chave atual barra a segunda.
const erroDeIndice = (constraint: string) => ({ cause: { code: '23505', constraint } })

test('corrida de troca: só o 23505 do índice da chave atual conta; outro índice e outros erros não', () => {
  assert.equal(ehCorridaDeTroca(erroDeIndice('api_chaves_atual_key')), true)
  assert.equal(ehCorridaDeTroca(erroDeIndice('outro_indice')), false)
  assert.equal(ehCorridaDeTroca(new Error('falhou')), false)
})

test('erro ao gerar ou trocar: a corrida recebe a frase de recarregar; qualquer outro erro recebe a frase da ação, sem a mensagem do erro', () => {
  assert.equal(fraseDoErroDaChave(erroDeIndice('api_chaves_atual_key'), FRASE_ERRO_GERAR), 'A chave acabou de ser trocada. Recarregue a página.')
  const outro = Object.assign(new Error('insert into api_chaves (hash) values ($1)'), { cause: { code: '42P01' } })
  const frase = fraseDoErroDaChave(outro, FRASE_ERRO_GERAR)
  assert.equal(frase, 'Não deu para gerar a chave. Nenhuma chave foi criada e a atual continua valendo. Tente de novo.')
  assert.equal(frase.includes('insert'), false)
})

test('log da troca: sem chave atual antes é gerada; com chave atual trocada é trocada', () => {
  assert.equal(tipoDoLogDaTroca({ revogar: [], expirar: [] }), 'api_chave_gerada')
  assert.equal(tipoDoLogDaTroca({ revogar: ['v'], expirar: [] }), 'api_chave_gerada')
  assert.equal(tipoDoLogDaTroca({ revogar: [], expirar: [{ id: 'a', validaAte: emMs(CARENCIA_MS) }] }), 'api_chave_trocada')
})
