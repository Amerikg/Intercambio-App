# Intercambio familiar navideño

Aplicación web sencilla para organizar el sorteo del intercambio familiar. Cada integrante elige su nombre para descubrir a quién regalarle; el sorteo no asigna a nadie a sí mismo ni repite destinatarios.

## Cómo usarla

Abre `index.html` en un navegador o sirve la carpeta con un servidor local:

```sh
python3 -m http.server 8000
```

Después visita `http://localhost:8000`. Agrega al menos dos participantes y selecciona **Hacer el sorteo**. Pasen el dispositivo de uno en uno, elijan un nombre y oculten el resultado antes de que siga la próxima persona.

Los nombres y el sorteo se guardan en el almacenamiento local del navegador. No hay servidor ni sincronización entre dispositivos; todas las personas deben usar el mismo navegador y dispositivo.