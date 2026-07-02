# ClimateProyectar

Interfaz web y catálogo nacional de 10.601 localidades.

Este repositorio **no descarga datos meteorológicos**. Consume:

- observaciones: `climate-observations`;
- pronósticos: `climate-forecasts`;
- radar y satélite: desactivados hasta sus etapas correspondientes.

## Publicación

GitHub Pages debe usar `main` y la carpeta `/docs`.

## Configuración de fuentes

Editar únicamente:

```text
docs/config/data-sources.json
```

Los repositorios del mismo usuario se publican bajo el mismo host de GitHub Pages,
por lo que el navegador puede consumirlos como rutas hermanas.
