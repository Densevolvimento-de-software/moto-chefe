import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dataHoraBrt, horasQueFaltam, progressoDoPrazo, textoDaTroca, textoFaltam } from './chave-da-tela'

const HORA = 60 * 60 * 1000
const AGORA = new Date('2026-11-28T12:00:00Z')
const emHoras = (h: number) => new Date(AGORA.getTime() + h * HORA)

test('data e hora saem no fuso de Brasília, também perto da meia-noite', () => {
  assert.equal(dataHoraBrt(new Date('2026-11-28T12:05:00Z')), '28/11/2026, 09:05')
  assert.equal(dataHoraBrt(new Date('2026-11-29T02:30:00Z')), '28/11/2026, 23:30')
})

test('horas que faltam arredondam para cima e nunca saem negativas', () => {
  assert.equal(horasQueFaltam(emHoras(18), AGORA), 18)
  assert.equal(horasQueFaltam(new Date(AGORA.getTime() + 17.5 * HORA), AGORA), 18)
  assert.equal(horasQueFaltam(emHoras(-2), AGORA), 0)
})

test('texto de horas no singular e no plural', () => {
  assert.equal(textoFaltam(1), 'Falta 1 hora')
  assert.equal(textoFaltam(18), 'Faltam 18 horas')
})

test('progresso do prazo de 24 horas: 25% com 6 horas passadas; 0 antes do início; 100 depois do fim', () => {
  assert.equal(progressoDoPrazo(emHoras(18), AGORA), 25)
  assert.equal(progressoDoPrazo(emHoras(48), AGORA), 0)
  assert.equal(progressoDoPrazo(emHoras(-12), AGORA), 100)
})

test('texto da troca sem chave no prazo: só a frase da chave atual', () => {
  assert.equal(textoDaTroca(null), 'Gerar uma chave nova. A chave atual vale por mais 24 horas.')
})

// 12:00 UTC é 09:00 em Brasília: o prazo de 24 horas a partir de agora acaba às 09:00 do dia seguinte.
test('texto da troca com chave no prazo: a frase da anterior diz até quando vale e que para na hora', () => {
  assert.equal(
    textoDaTroca(emHoras(24)),
    'Gerar uma chave nova. A chave atual vale por mais 24 horas. A chave anterior, que vale até 29/11/2026, 09:00, para na hora.',
  )
})
