# ASCII Transition Component

Componente interactivo de Angular que transforma una imagen en una composición de caracteres ASCII y realiza una transición animada entre los caracteres y la imagen original.

## Requisitos

Versiones del entorno en el que se ha desarrollado y probado:

| Tecnología | Versión |
|---|---|
| Angular CLI | 21.2.29 |
| Angular | 21.2.26 |
| Node.js | 25.8.1 |
| npm | 11.11.0 |

**Dependencia externa:** GSAP

## Instalación e integración

### 1. Instalar GSAP

Desde la raíz del proyecto Angular, ejecuta el siguiente comando:

```bash
npm install gsap
```

### 2. Incorporar los archivos del componente

Copia todos los archivos del componente dentro de una carpeta llamada `ascii-component`, manteniendo juntos sus archivos HTML, TypeScript, SCSS y pruebas.

Estructura recomendada:

```text
src/
└── app/
    └── modules/
        └── components/
            └── ascii-component/
                ├── asciitransition-component.ts
                ├── asciitransition-component.html
                ├── asciitransition-component.scss
                └── asciitransition-component.spec.ts
```

Comprueba que las referencias internas del componente coincidan con los nombres y las rutas de los archivos.

### 3. Importar el componente

Importa `AsciitransitionComponent` en el componente principal (`app.ts`) o en cualquier otro componente standalone donde quieras utilizarlo.

Por ejemplo, en `app.ts`:

```typescript
import { AsciitransitionComponent } from './modules/components/ascii-component/asciitransition-component';

@Component({
  selector: 'app-root',
  imports: [AsciitransitionComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {}
```

Adapta la ruta de importación según la estructura de carpetas de tu proyecto.

### 4. Utilizar el componente

Una vez importado, puedes incorporar su selector directamente en el HTML:

```html
<app-asciitransition-component
  src="/assets/images/example.jpg"
  alt="Ejemplo de transición ASCII"
/>
```

Sustituye la ruta de la imagen por la ubicación del recurso que quieras utilizar.

## Consideraciones

- El componente utiliza la arquitectura standalone de Angular.
- GSAP es necesario para ejecutar las animaciones.
- El archivo `.spec.ts` contiene las pruebas unitarias y no es necesario para el funcionamiento del componente en producción.
- Las imágenes deben estar disponibles desde una ruta pública o desde el directorio de recursos configurado en Angular.

## Desarrollo

Para iniciar el servidor de desarrollo de Angular:

```bash
ng serve
```

A continuación, accede a `http://localhost:4200/` desde tu navegador.
