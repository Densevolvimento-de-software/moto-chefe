import { test } from 'node:test'
import assert from 'node:assert/strict'
import { percentualDoBruto, pixConciliados } from './card-deducao'

test('percentualDoBruto: pt-BR, uma a duas casas (o custo do PIX costuma ficar abaixo de 0,1%)', () => {
  assert.deepEqual([percentualDoBruto(9_874.2, 400_000), percentualDoBruto(318.4, 400_000), percentualDoBruto(10, 1_000)], ['2,47%', '0,08%', '1,0%'])
})

test('pixConciliados: singular e plural', () => {
  assert.deepEqual([pixConciliados(1), pixConciliados(41), pixConciliados(0)], ['1 PIX conciliado', '41 PIX conciliados', '0 PIX conciliados'])
})
