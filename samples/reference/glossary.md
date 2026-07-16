# Glossary

## Terms

| Term        | Meaning                                                              |
| ----------- | -------------------------------------------------------------------- |
| Panel       | One flat piece of a garment, exported as a single glTF mesh.          |
| Seam        | A declared join between two panel edges. Metadata, never geometry.    |
| Drape       | The solver pass that pulls sewn panels together under gravity.        |
| Lattice     | The regular vertex grid a panel's mesh is built from.                 |
| Slack       | Extra edge length allowed at a seam before tension is applied.        |

## Units

All exported geometry is in metres, Y-up, right-handed — matching glTF's own
convention so no basis change is needed on import.

> [!CAUTION]
> Sketch space is Z-up. The exporter performs the swap; do not do it twice.
