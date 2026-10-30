# Blender cook (issue #79 pilot)

`cook-pilot.py` builds the cook from scratch in Blender 5.2 with the MPFB extension
(MakeHuman body, `game_engine` skeleton with finger bones), dresses him (samue
jacket, trousers, tenugui headband, maekake apron, short hair), poses him and
exports `public/models/cook-pilot.glb`.

    COOK_EXPORT=1 COOK_GLB=public/models/cook-pilot.glb \
      /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/cook-pilot.py

`COOK_RENDER=1 COOK_OUT=/some/dir/` renders front and close-up stills instead.

The clothes, hair and eyebrows come from MakeHuman's CC0 system assets
(`male_casualsuit02`, `short02`, `eyebrow001`), released as CC0 by the MakeHuman
copyright holders. Download
https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip,
unzip it, and point `MH_ASSETS` at its folder (default `~/makehuman-assets/sys`).
The look follows how ramen shop cooks dress: black T-shirt, dark trousers, a
twisted towel tied round the head, and an indigo waist apron.
The site only loads the cook when the URL has `?cook=pilot`. He rides on the
code-built stand-in cook: his arms and legs are solved with two-bone IK onto the
stand-in's hands and feet every frame, so he stirs, reads orders, carries,
serves and walks exactly where the tested stand-in does.
