#!/bin/sh
# Makes the two smaller versions of each photo that the page actually uses:
#   <folder>/thumb/NN.jpg   640 px wide: the film strips and the outer glass
#   <folder>/mid/NN.jpg    1100 px wide: the magnified view in the eyepiece, loaded only when it looks there
# The originals stay where they are and are not loaded by the page.
# usage: tools/make-images.sh sample-photos
set -e
dir="${1:-sample-photos}"
mkdir -p "$dir/thumb" "$dir/mid"
for f in "$dir"/*.jpg; do
  n=$(basename "$f")
  ffmpeg -loglevel error -y -i "$f" -vf "scale='min(640,iw)':-2:flags=lanczos" -q:v 4 -map_metadata -1 "$dir/thumb/$n"
  ffmpeg -loglevel error -y -i "$f" -vf "scale='min(1100,iw)':-2:flags=lanczos" -q:v 3 -map_metadata -1 "$dir/mid/$n"
done
echo "made $(ls "$dir"/thumb | wc -l) thumbnails and $(ls "$dir"/mid | wc -l) mid-size images in $dir"
