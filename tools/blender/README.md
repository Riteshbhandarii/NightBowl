# Blender cook (issue #79 pilot)

`cook-pilot.py` builds the cook from scratch in Blender 5.2 with the MPFB extension
(MakeHuman body, `game_engine` skeleton with finger bones), dresses him (samue
jacket, trousers, tenugui headband, maekake apron, short hair), poses him and
exports `public/models/cook-pilot.glb`.

    COOK_EXPORT=1 COOK_GLB=public/models/cook-pilot.glb \
      /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/cook-pilot.py

`COOK_RENDER=1 COOK_OUT=/some/dir/` renders front and close-up stills instead.
The site only loads the pilot when the URL has `?cook=pilot`; it rides on the
stand-in cook's root and does not animate yet.
