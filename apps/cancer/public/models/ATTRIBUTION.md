# 3D body models: sources and licence

`body-female.glb` and `body-male.glb` are built by `scripts/build-body-models.mjs` from the sources
below. Because they include adapted BodyParts3D and Z-Anatomy material, **the combined GLB files are
shared under Creative Commons Attribution-ShareAlike (CC BY-SA 4.0)**: reuse them with the attributions
below, and share anything derived from them under the same licence.

## 1. Human Reference Atlas (HRA) 3D Reference Organ Sets v1.10

*HuBMAP 3D Reference Organ Sets* v1.10, Browne & Schlehlein (2026), HuBMAP Consortium,
<https://humanatlas.io>. Licence: **CC BY 4.0**. Built on the Visible Human Project data of the U.S.
National Library of Medicine. One female and one male body (the "united" files,
`https://cdn.humanatlas.io/digital-objects/ref-organ/united-{female,male}/v1.10/`).

Groups taken from the atlas: `skin`, `brain`, `oral`, `larynx`, `lung`, `breast`, `liver`, `pancreas`,
`kidney`, `colorectum`, `bladder`, `uterus`, `cervix`, `ovary`, `vagina`, `fallopian`, `prostate`,
`seminal`, `lymph`, `heart`, `intestine`, `spleen`, `gallbladder`, `trachea`, `blood` (the pelvis), and
within `skeleton` the vertebral column, leg bones and knees, the female sternum and manubrium and the
male hyoid.

Changes: meshes were flattened, stripped to positions, simplified and compressed. The lymph node is
enlarged 2.5x so it can be seen. The brain is rescaled (by a few percent, non-uniformly) so that it sits
inside the fitted skull; in the atlas it all but touches the skin.

## 2. BodyParts3D 4.0

**BodyParts3D, (c) The Database Center for Life Science, licensed under CC Attribution-Share Alike 2.1
Japan.** <https://lifesciencedb.jp/bp3d/>, archive `isa_BP3D_4.0_obj_99.zip` from
<https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/>. One adult male body.

Groups and parts taken from BodyParts3D:

- within `skeleton`: skull with mandible and teeth, ribs and costal cartilages, clavicles, scapulae,
  humerus, radius, ulna, hand bones, foot bones, xiphoid process; the sternum on the male body and the
  hyoid on the female body (each atlas body has only one of the two);
- within `blood` on the female body: the ischium and pubis, cut from the hip bones (the female atlas
  pelvis has only sacrum, coccyx and ilia);
- `stomach`, `oesophagus` (both bodies); `testis`, `penis` (male body).

These parts were **adapted**: converted to the atlas's frame, then scaled, rotated and in places warped
piecewise to fit inside each atlas body (rib cage to the lungs and thoracic spine, skull to the brain
and face, arms and fingers to the skin's arms and fingertips, feet to the skin's feet, oesophagus to the
spinal curve, stomach to the neighbouring organs, penis to the atlas's urethra), and simplified. **The
female body carries these same male-derived parts, scaled by her own transforms; that is an
approximation, not female anatomy.**

## 3. Z-Anatomy

**Z-Anatomy, the libre 3D atlas of anatomy**, <https://www.z-anatomy.com/>, licence **CC BY-SA 4.0**; itself
derived from BodyParts3D. Used for the `thyroid` group only (BodyParts3D has no thyroid gland), taken
from the glTF export in <https://github.com/DrMuratAltun/anatomi-simulatoru> (`systems/ic-organlar.glb`,
commit 37e85df). Adapted: scaled and placed against each atlas body's trachea and larynx.
