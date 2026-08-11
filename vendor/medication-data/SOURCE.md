# Portable pill-characteristics index

This directory contains a compact index generated from the U.S. National Library of Medicine's RxNorm Current Prescribable Content release. The selected release requires no UMLS license. Physical pill characteristics originate from FDA/DailyMed Structured Product Labeling records represented by the `MTHSPL` source in RxNorm.

Source release: RxNorm Current Prescribable Content, August 3, 2026.

Generated index SHA-256: `9DF9FC5FCC986F9902E4A37B88C98E6D850BBBD5F8039710CCEA212160BBF8AE`

Source page: https://www.nlm.nih.gov/research/umls/rxnorm/docs/rxnormfiles.html

RxNorm terms: https://www.nlm.nih.gov/research/umls/rxnorm/docs/termsofservice.html

The generated index excludes images and proprietary commercial pill-finder content. It contains only the fields Outpost Zero needs for offline possible-match searching: product name, product NDC, imprint, color, shape, size, score, and SPL set identifier.

Required NLM attribution:

> This product uses publicly available data courtesy of the U.S. National Library of Medicine (NLM), National Institutes of Health, Department of Health and Human Services; NLM is not responsible for the product and does not endorse or recommend this or any other product.

To regenerate the index after obtaining the current no-license-required release:

```text
node scripts/build-rxnorm-pill-index.mjs RXNCONSO.RRF RXNSAT.RRF vendor/medication-data/pill-index.json YYYY-MM-DD
```
