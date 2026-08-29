# Nature Library and Nature ID

## Runtime architecture

Nature is one entry in the Outpost navigation. Search, Browse, Identify, Sightings, Packs, and Sources & Licenses are internal tabs. Home search also queries installed Nature Packs.

An `.oznature` file is a read-only SQLite database containing taxonomy, vernacular names, synonyms, regional distribution summaries, reference-image bytes, image attribution, and an FTS5 search index. Keeping the pack self-contained makes installation and replacement atomic on removable media. The application database stores only the installed-pack registry and private sightings.

Runtime locations:

- `Content/Nature/Packs`: installed `.oznature` databases
- `AI/Nature/Models`: verified ONNX vision encoders
- `Data/Nature`: private Nature runtime data
- `Cache/Nature/catalog.json`: last verified signed Outpost download catalog
- `Config/nature-catalog.json`: optional operator-supplied catalog additions

Nature refreshes its small signed catalog when the page opens while connected. It does not call a web API while browsing, searching, opening images, or viewing sightings. Pack downloads happen only after an explicit Download action, and the last verified catalog remains usable offline.

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

### Regional species input

For a quick development-only Missouri list, query the public GBIF occurrence facets. This produces a small TSV and a provenance sidecar clearly marked `publishable: false`:

```powershell
node scripts/prepare-regional-nature.mjs --mode preview --region Missouri --gadm-gid USA.26_1 --output VendorCache\nature\missouri-preview.tsv
```

The final published pack must instead use a GBIF download with its assigned DOI. Export or unzip the GBIF occurrence TSV, then run:

```powershell
node scripts/prepare-regional-nature.mjs --mode gbif-download --region Missouri --input C:\data\gbif-occurrence.txt --gbif-doi 10.15468/dl.EXAMPLE --output C:\data\missouri-species.tsv
```

Neither mode accepts or stores a GBIF username or password. The DOI-backed provenance sidecar is automatically included in the pack manifest. A preview input is rejected unless the developer explicitly passes `--allow-preview true`.

### Low-disk build

The builder can stream `NameUsage.tsv`, `VernacularName.tsv`, and `Distribution.tsv` directly from the official ColDP ZIP. This avoids creating a second multi-gigabyte extracted source tree:

```powershell
node scripts/build-nature-pack.mjs --coldp-archive C:\data\COL-Base-ColDP.zip --regional-species C:\data\missouri-species.tsv --pack-id missouri --name "Missouri Nature Pack" --region Missouri --version 2026.08 --catalogue-version 2026-07-14 --output C:\packs\missouri-2026.08.oznature
```

Source archives are never downloaded by Outpost or by the pack builder. Download them deliberately, check free space first, and remove the archive after the finished pack and provenance have been verified. Temporary development downloads should remain under the ignored `VendorCache/nature` directory.

1. Download a pinned Catalogue of Life Base ColDP release. Pass the ZIP with `--coldp-archive` to conserve disk space, or extract it and use `--coldp`.
2. For a regional pack, create a tab-separated species list from a cited GBIF bulk download. Keep its download DOI with the build record. GBIF credentials stay outside this repository.
3. Select iNaturalist images from a pinned monthly Open Data metadata snapshot. Download medium images and produce a TSV manifest with `scientificName`, `file`, `creator`, `sourceUrl`, `license`, and `licenseUrl`. Exclude every license other than CC0 or CC BY.
4. Run:

```powershell
node scripts/build-nature-pack.mjs --coldp C:\data\COL --regional-species C:\data\missouri-species.tsv --images C:\data\missouri-images.tsv --pack-id missouri --name "Missouri Nature Pack" --region Missouri --version 2026.08 --catalogue-version 2026-07-14 --gbif-version 10.15468/dl.EXAMPLE --inaturalist-version 2026-08 --output C:\packs\missouri-2026.08.oznature
```

The builder refuses to overwrite an output. It creates a catalog-entry sidecar containing the actual final size and SHA-256. Replace its placeholder URL only after uploading the exact pack artifact.

## Catalog format

The official catalog is an Ed25519-signed envelope published at `Nature/catalog.json` in the runtime-distribution repository. Outpost verifies it with the update trust key before caching or displaying any entry. Each entry requires an ID, kind (`pack` or `model`), name, version, HTTPS URL, SHA-256, exact download and installed byte counts, and description. Pack entries may specify `archive: "zip"`; such an archive must contain exactly one safe `.oznature` file. Outpost verifies the archive before extraction and validates the contained SQLite pack before installation.

`Config/nature-catalog.json` may contain `{ "entries": [...] }` for operator-managed additions. An unavailable online catalog never prevents installed packs from working or a verified local pack from being imported.

## Model deployment

The intended standard model is the official MIT-licensed BioCLIP 2 vision encoder, converted to ONNX at build time and checked numerically against OpenCLIP. Regional text embeddings must be generated using the exact same checkpoint and preprocessing. Original BioCLIP is the lightweight tier; BioCLIP 2.5 Huge is optional for high-end systems.

Do not publish a model catalog entry until the ONNX graph, preprocessing, output normalization, CPU execution, DirectML execution, and regional embeddings have passed fixtures. The runtime deliberately leaves Identify disabled for an unvalidated encoder rather than returning plausible but incorrect matches.

## Offline verification

After installing a pack and validated model, block Outpost Zero in the Windows firewall or disconnect networking, restart it, and verify search, categories, species pages, images, attribution, sightings, and identification. Monitor connections during the test. No Nature browsing or inference operation should issue a network request.
