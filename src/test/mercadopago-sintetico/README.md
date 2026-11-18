# Fixtures do Mercado Pago (Point)

Valores inventados (ids 1000000001..., serial `FAKESERIAL01`, nome fictício). A forma segue a conta
real conferida em 18/11/2026 (#51), sem copiar nenhum valor dela:

- cartão da maquininha: `point_of_interaction.type = "POINT"` com `device.serial_number`;
- Pix na maquininha: `point_of_interaction.type = "INSTORE"` com `device.serial_number`;
- link de pagamento: `point_of_interaction.type = "CHECKOUT"`, sem serial (fica de fora).

A regra que decide "veio da maquininha" é só `ehDaMaquininha`, em `conciliacao-mercadopago.ts`.
