import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acessoriosDoFormulario, algumValorMudou, avisoDaTrava, clienteMudou, compradorDoFormulario, editaPeloPedido, nfQueTravaOPedido, recusaDaEdicaoNaNota } from './pedido-efetivado-regras'

const AGORA = new Date('2026-11-18T15:00:00Z')
const autorizada = { ambiente: 'Producao', status: 'Autorizada', dataAutorizacao: '2026-11-18T12:00:00Z', numero: '27' }

test('NF que trava o pedido: a NF de produção viva de qualquer venda dele, pela regra do Cancelar venda', () => {
  const vendas = [{ notas: [], notaFiscalSaida: null }, { notas: [autorizada], notaFiscalSaida: '27' }]
  assert.deepEqual(nfQueTravaOPedido(vendas, 'admin_socio', AGORA), { numero: '27', por: 'nota' })
})

test('NF que trava o pedido: homologação e cancelada não travam; sem NF, nada trava', () => {
  const mortas = [{ ...autorizada, ambiente: 'Homologacao' }, { ...autorizada, status: 'Cancelada' }]
  assert.equal(nfQueTravaOPedido([{ notas: mortas, notaFiscalSaida: null }], 'admin_socio', AGORA), null)
})

test('NF que trava o pedido: o nº de NF preenchido (Bling, Confirmar NF) trava o aux_adm, não o sócio (#191)', () => {
  const vendas = [{ notas: [], notaFiscalSaida: null }, { notas: [], notaFiscalSaida: '4321' }]
  assert.deepEqual(nfQueTravaOPedido(vendas, 'aux_adm', AGORA), { numero: '4321', por: 'papel' })
  assert.equal(nfQueTravaOPedido(vendas, 'admin_socio', AGORA), null)
})

const GRAVADO = { clienteNome: 'Ana', clienteCpf: '529.982.247-25', clienteCidade: 'Timon', clienteEmail: null }

test('cliente mudou: nome, documento ou endereço diferente do gravado', () => {
  assert.equal(clienteMudou(GRAVADO, { clienteNome: 'Ana Maria', clienteCpf: '52998224725' }), true)
  assert.equal(clienteMudou(GRAVADO, { clienteNome: 'Ana', clienteCpf: '111.444.777-35' }), true)
  assert.equal(clienteMudou(GRAVADO, { clienteNome: 'Ana', clienteCpf: '52998224725', clienteCidade: 'Teresina' }), true)
})

test('cliente não mudou: mesmo documento com ou sem máscara, campo ausente e vazio igual a nulo', () => {
  assert.equal(clienteMudou(GRAVADO, { clienteNome: 'Ana', clienteCpf: '52998224725', clienteEmail: '', clienteCidade: undefined }), false)
})

test('algum valor mudou: compara por item, com tolerância de meio centavo', () => {
  const gravados = new Map([['m1', 10000], ['m2', 5200]])
  assert.equal(algumValorMudou(gravados, [{ chave: 'm1', valor: 10000.004 }, { chave: 'm2', valor: 5200 }]), false)
  assert.equal(algumValorMudou(gravados, [{ chave: 'm1', valor: 10000 }, { chave: 'm2', valor: 5190 }]), true)
})

test('recusa da edição com NF: só quando a nota trava e cliente ou valor mudou', () => {
  assert.equal(recusaDaEdicaoNaNota({ numero: '27', por: 'nota' }, true),
    'A nota fiscal nº 27 está valendo. Itens, valores e cliente estão nela e não mudam. Para mudar, cancele a nota antes.')
  assert.equal(recusaDaEdicaoNaNota({ numero: null, por: 'nota' }, true),
    'A nota fiscal do pedido está valendo. Itens, valores e cliente estão nela e não mudam. Para mudar, cancele a nota antes.')
  assert.equal(recusaDaEdicaoNaNota({ numero: '27', por: 'nota' }, false), null)
  assert.equal(recusaDaEdicaoNaNota(null, true), null)
})

test('comprador do formulário: só os campos do comprador, campo a campo; o que sobra (Conta, loja, id) fica de fora', () => {
  const forjado = { clienteNome: 'Ana', clienteCpf: '52998224725', clienteEmail: null, lojaId: 'x', grupoId: 'y', id: 'z', valor: '1' }
  assert.deepEqual(compradorDoFormulario(forjado), { clienteNome: 'Ana', clienteCpf: '52998224725', clienteEmail: null })
})

test('acessórios do formulário: lista de { pecaId, valor } refeita campo a campo; forma errada ou valor inválido é null', () => {
  assert.deepEqual(acessoriosDoFormulario([{ pecaId: 'p1', valor: 250, extra: 1 }]), [{ pecaId: 'p1', valor: 250 }])
  assert.deepEqual(acessoriosDoFormulario([]), [])
  for (const ruim of [undefined, 'p1', [{ pecaId: 1, valor: 2 }], [{ pecaId: 'p1', valor: -1 }], [{ pecaId: 'p1', valor: Infinity }], [{ pecaId: 'p1' }]]) {
    assert.equal(acessoriosDoFormulario(ruim), null, JSON.stringify(ruim))
  }
})

test('recusa da edição pelo nº de NF do aux_adm (#191): a frase diz que cliente e valores ficam com os administradores', () => {
  assert.equal(recusaDaEdicaoNaNota({ numero: '4321', por: 'papel' }, true),
    'Esta venda tem NF registrada (nº 4321). Cliente e valores só mudam com os administradores. Dá para corrigir o pagamento.')
})

test('edita pelo pedido (P6): pedido com 2+ vendas ou com brinde/acessório; venda de 1 moto sem peça segue no Editar venda', () => {
  assert.equal(editaPeloPedido({ vendas: 1, pecas: 0 }), false)
  assert.equal(editaPeloPedido({ vendas: 2, pecas: 0 }), true)
  assert.equal(editaPeloPedido({ vendas: 1, pecas: 1 }), true)
})

test('aviso da trava na tela (25d): com NF diz que o pagamento se corrige; pelo nº de NF do aux_adm, a frase do papel', () => {
  assert.equal(avisoDaTrava({ numero: '27', por: 'nota' }),
    'A nota fiscal nº 27 está valendo. Itens, valores e cliente estão nela e não mudam. Para mudar, cancele a nota antes. Dá para corrigir o pagamento.')
  assert.equal(avisoDaTrava({ numero: '4321', por: 'papel' }),
    'Esta venda tem NF registrada (nº 4321). Cliente e valores só mudam com os administradores. Dá para corrigir o pagamento.')
})
