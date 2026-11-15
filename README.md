# Fitia → ChatGPT en Cloudflare

Servidor gratuito para recibir automáticamente desde la app Android los totales que Fitia publica en Health Connect y permitir que un GPT personalizado consulte calorías y macronutrientes restantes.

## Despliegue

Este repositorio está preparado para **Deploy to Cloudflare**. El proceso crea automáticamente:

- un Worker HTTPS que no se duerme;
- una base D1 persistente;
- las tablas mediante una migración;
- el vínculo con GitHub para futuras actualizaciones.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/JuniorB23/fitia-chatgpt-cloudflare)

Durante el despliegue se solicita `BRIDGE_API_KEY`. Usa un token aleatorio de al menos 32 caracteres y conserva el mismo valor para la aplicación Android y la GPT Action.

## Endpoints compatibles con la app existente

- `GET /health`
- `POST /v1/intake`
- `GET /v1/day/today`
- `GET /v1/day/YYYY-MM-DD`

Todos salvo `/health` requieren `Authorization: Bearer <token>` o `X-API-Key: <token>`.

## Datos y privacidad

La base conserva únicamente fecha, calorías, proteínas, carbohidratos, grasas y agregados por comida que Health Connect entrega. No recibe la contraseña de Fitia, fotos, actividad, peso, sueño, contactos ni ubicación.

## Pruebas

```sh
npm test
```

Objetivos incorporados: 2.500 kcal, 165 g de proteína, 291 g de carbohidratos y 75 g de grasa; zona horaria `America/Asuncion`.
