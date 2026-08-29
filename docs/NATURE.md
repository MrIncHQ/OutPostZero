# Nature Library and Nature ID

## Runtime architecture

Nature is one entry in the Outpost navigation. Search, Browse, Identify, Sightings, Packs, and Sources & Licenses are internal tabs. Home search also queries installed Nature Packs.

An `.oznature` file is a read-only SQLite database containing taxonomy, vernacular names, synonyms, regional distribution summaries, reference-image bytes, image attribution, and an FTS5 search index. Keeping the pack self-contained makes installation and replacement atomic on removable media. The application database stores only the installed-pack registry and private sightings.

Runtime locations:

- `Content/Nature/Packs`: installed `.oznature` databases
- `AI/Nature/Models`: verified ONNX vision encoders
- `Data/Nature`: private Nature runtime data
- `Config/nature-catalog.json`: optional published pack/model download catalog

Nature does not call a web API while browsing, searching, opening images, or viewing sightings. Catalog downloads happen only after an explicit Download action.

## Verified source choices

- Catalogue of Life Base Release in ColDP is the primary taxonomy source. A build without `--regional-species` produces a global taxonomy pack; Extended Release content can be built separately but must be identified as XR in the source version.
- GBIF occurrence downloads are a pack-build input only. Creating a download requires a GBIF account, so credentials and download DOI records remain outside the portable client.
- iNaturalist Open Data monthly metadata and medium images are pack-build inputs. The builder accepts only CC0 and CC BY image records and requires creator, original source URL, license, and license URL for every stored image.
- BioCLIP 2 is the planned Standard encoder because its official code/model is MIT licensed and it offers stronger current coverage than the original BioCLIP. Original BioCLIP remains the intended Lightweight tier; BioCLIP 2.5 Huge is reserved for a future high-end tier after portable-runtime validation.

Official references: [Catalogue of Life](https://www.catalogueoflife.org/), [iNaturalist Open Data](https://github.com/inaturalist/inaturalist-open-data), [GBIF occurrence downloads](https://techdocs.gbif.org/en/data-use/api-downloads), and [BioCLIP 2](https://github.com/Imageomics/bioclip-2).

## Pack schema and manifest

Required tables are `pack_metadata`, `species`, `species_names`, `species_distribution`, `species_images`, and `species_fts`. `pack_metadata.manifest` contains schema version, pack ID, region, version, build date, exact counts and sizes, source versions, categories, licenses, and dependencies. Download SHA-256 belongs in the external catalog because a file cannot contain its own stable digest.

Only `CC0`, `CC0-1.0`, `CC BY`, and `CC-BY-4.0` image records are accepted by the current builder. Creator, original URL, license, and license URL are mandatory and retained beside every image.

## Building a pack

Pack creation is a developer operation and may use large source archives. It is not performed by the portable client.

1. Download and extract a pinned Catalogue of Life Base ColDP release.
2. For a regional pack, create a tab-separated species list from a cited GBIF bulk download. Keep its download DOI with the build record. GBIF credentials stay outside this repository.
3. Select iNaturalist images from a pinned monthly Open Data metadata snapshot. Download medium images and produce a TSV manifest with `scientificName`, `file`, `creator`, `sourceUrl`, `license`, and `licenseUrl`. Exclude every license other than CC0 or CC BY.
4. Run:

```powershell
node scripts/build-nature-pack.mjs --coldp C:\data\COL --regional-species C:\data\missouri-species.tsv --images C:\data\missouri-images.tsv --pack-id missouri --name "Missouri Nature Pack" --region Missouri --version 2026.08 --catalogue-version 2026-07-14 --gbif-version 10.15468/dl.EXAMPLE --inaturalist-version 2026-08 --output C:\packs\missouri-2026.08.oznature
```

The builder refuses to overwrite an output. It creates a catalog-entry sidecar containing the actual final size and SHA-256. Replace its placeholder URL only after uploading the exact pack artifact.

## Catalog format

`Config/nature-catalog.json` contains `{ "entries": [...] }`. Each entry requires an ID, kind (`pack` or `model`), name, version, HTTPS URL, SHA-256, exact download and installed byte counts, and description. An empty or absent catalog is valid; local verified packs can still be imported.

## Model deployment

The intended standard model is the official MIT-licensed BioCLIP 2 vision encoder, converted to ONNX at build time and checked numerically against OpenCLIP. Regional text embeddings must be generated using the exact same checkpoint and preprocessing. Original BioCLIP is the lightweight tier; BioCLIP 2.5 Huge is optional for high-end systems.

Do not publish a model catalog entry until the ONNX graph, preprocessing, output normalization, CPU execution, DirectML execution, and regional embeddings have passed fixtures. The runtime deliberately leaves Identify disabled for an unvalidated encoder rather than returning plausible but incorrect matches.

## Offline verification

After installing a pack and validated model, block Outpost Zero in the Windows firewall or disconnect networking, restart it, and verify search, categories, species pages, images, attribution, sightings, and identification. Monitor connections during the test. No Nature browsing or inference operation should issue a network request.
