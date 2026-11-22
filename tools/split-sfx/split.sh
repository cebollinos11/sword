#!/usr/bin/env bash
# Cuts the sound effects in newsounds/ into the single clips public/sfx/ plays (see src/audio/stock.ts).
# Each clip: mono, 44.1 kHz MP3, a short fade-out, peak-normalised to 0 dB. Needs ffmpeg.
# Usage: bash tools/split-sfx/split.sh   (from the repo root; rewrites the files it names)
set -euo pipefail
SRC=newsounds
OUT=public/sfx
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# clip <source file> <start s> <end s> <output name>
clip() {
  local src=$1 from=$2 to=$3 name=$4
  local dur fade_at gain
  dur=$(awk -v a="$from" -v b="$to" 'BEGIN{printf "%.3f", b-a}')
  fade_at=$(awk -v d="$dur" 'BEGIN{printf "%.3f", (d>0.06? d-0.05 : 0)}')
  ffmpeg -v error -y -ss "$from" -t "$dur" -i "$src" -ac 1 -ar 44100 -af "afade=t=out:st=$fade_at:d=0.05" "$tmp/raw.wav"
  gain=$(ffmpeg -hide_banner -nostats -i "$tmp/raw.wav" -af volumedetect -f null - 2>&1 | sed -n 's/.*max_volume: \(-\?[0-9.]*\) dB.*/\1/p')
  ffmpeg -v error -y -i "$tmp/raw.wav" -af "volume=$(awk -v g="$gain" 'BEGIN{print -g}')dB" -codec:a libmp3lame -q:a 4 "$OUT/$name.mp3"
}

# A blade's swing: the swipes file holds seven whooshes, then two single swings.
S=$SRC/attack-swing/freesound_community-sword-swipes-7174.mp3
n=3
for seg in "0.34 0.60" "1.13 1.65" "2.48 2.97" "3.49 3.82" "4.07 4.55" "5.04 5.41" "5.89 6.14"; do
  clip "$S" ${seg% *} ${seg#* } "swing-$n"; n=$((n+1))
done
clip $SRC/attack-swing/oxidvideos-sword-swing-sfx-407574.mp3 0 0.40 swing-10
clip $SRC/attack-swing/oxidvideos-video-game-sword-swing-sfx-409364.mp3 0 0.34 swing-11

# Steel on steel.
clip $SRC/blade-clash/dragon-studio-sword-clashhit-393837.mp3 0 0.75 clang-4
clip $SRC/blade-clash/u_fe12rqkbth-sword-clash-241729.mp3 0 1.72 clang-5
clip $SRC/chamber/freesound_community-sword-schwing-40520.mp3 0 1.25 parry-1

# A blade in flesh.
clip $SRC/blade-damage/dragon-studio-violent-sword-slice-393839.mp3 0 1.10 hit-9
clip $SRC/blade-damage/dragon-studio-violent-sword-slice-393848.mp3 0 1.17 hit-10
clip $SRC/blade-damage/dragon-studio-violent-sword-slice-2-393841.mp3 0 1.02 hit-11
clip $SRC/blade-damage/dragon-studio-sword-slice-2-393845.mp3 0 1.02 hit-12

# A blunt weapon in flesh.
clip $SRC/blunt-damage/ragecore29-htf-flesh-impact-1-480118.mp3 0 0.98 heavy-hit-5

# A blunt weapon meeting a weapon: the twang file holds seven hits.
T=$SRC/blunt-hit/freesound_community-wood-hit-wood-metal-twang-36783.mp3
n=0
for seg in "0.43 1.00" "1.73 2.12" "2.78 3.08" "3.67 4.20" "4.97 5.40" "5.97 6.40" "6.94 7.46"; do
  clip "$T" ${seg% *} ${seg#* } "blunt-hit-$n"; n=$((n+1))
done

# Equipping an item.
clip $SRC/inventory/freesound_community-item-equip-6904.mp3 0 0.72 equip-0
