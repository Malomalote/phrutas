## Objetivo

Que la barra de energía se explique sola: etiquetas claras en el panel + una guía contextual de primera vez (coach-mark) que enseña para qué sirve y desaparece al usarla. El usuario elige «Onboarding + etiquetas».

## Cambios por archivo

### 1. `js/config.js` — textos y persistencia
- Añadir `CONFIG.storage.tutorialKey = 'sandia-jelly-tutor-v1'`.
- Añadir bloque `STR.tutorial`:
  - `titulo: '⚡ Energía'`
  - `lineas: ['Gana +2 por cada fusión.', 'Mantén Inclinar para inclinar el tarro (10/s).', 'Con 60, Amasar hace botar la gelatina.']`
  - `cerrar: 'Entendido'`
- Actualizar `STR.howto[1]` a: `'Cada fusión da +2 de energía: inclina el tarro para que rueden o amasa (−60) para hacer botar la gelatina.'`
- `STR.tiltLeft/tiltRight` → `'Inclinar tarro'` (un solo texto compartido para los dos micro-labels).

### 2. `js/ui/hud.js` — etiquetas + coach-mark
- Micro-labels de los botones de inclinación: usar el nuevo texto «Inclinar tarro» (nowrap, 9px; el rail ya tiene min-width para ello).
- Cabecera del rail: reubicar `#label-energy` (CSS, sin tocar index.html) como cabecera horizontal «ENERGÍA» arriba del track (ver punto 3).
- Nuevos métodos:
  - `showEnergyTip()`: si `localStorage[CONFIG.storage.tutorialKey]` existe, no hace nada. Si no, crea `#energy-tip` (div anclado al rail, flecha apuntando a la barra) con `STR.tutorial` y botón «Entendido»; animación de entrada; auto-fade a los 14 s. Al cerrar (botón, uso de energía o timeout) → guarda el flag y elimina el nodo.
  - `dismissEnergyTip()`: cierra y persiste (lo llama `game.js` al usar energía por primera vez).

### 3. `css/style.css` — estilo del tip y cabecera
- `#label-energy`: pasar a horizontal (`writing-mode: horizontal-tb`), `order: -1` en el flex del rail, 10px `#b8b2cc`, letter-spacing — cabecera legible arriba del track.
- `#energy-tip`: burbuja glass (mismo lenguaje que los paneles), anclada a la derecha del rail con flecha CSS, `z-index` sobre el canvas, animación fadeUp (respetando el bloque `prefers-reduced-motion` ya existente), lista con viñetas ⚡ y botón `.btn` pequeño «Entendido».

### 4. `js/core/game.js` — disparo y cierre
- En `start()`: si no es modo demo y el flag de tutor no existe → `setTimeout(() => this.hud.showEnergyTip(), 1200)` (guardado en `this._tipTimer`; limpiar en `toMenu()`/restart para sin fugas).
- En `setTilt(dir, pressed)` (cuando `pressed`) y en `soften()` (cuando se ejecuta): llamar `this.hud.dismissEnergyTip()` — usar la energía cierra la guía para siempre.
- No mostrar en `?demo=1`.

## Verificación
1. Recargar con `localStorage` limpio → entrar a jugar → a los ~1,2 s aparece la burbuja junto a la barra.
2. Mantener Inclinar → la burbuja desaparece y `localStorage['sandia-jelly-tutor-v1'] = '1'` → no vuelve a aparecer.
3. Recargar → ya no aparece; el menú muestra la viñeta de energía ampliada.
4. Captura de la burbuja visible para confirmar legibilidad.

## No incluido (fuera de alcance acordado)
- Rediseño del panel, recordar el tip en cada partida, o cambios de mecánica.