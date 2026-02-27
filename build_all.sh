#!/bin/bash
set -e

echo "Building Homepage..."
cd homepage
./build.sh
cd ..

echo "Building Text-to-Speech..."
cd text-to-speech
./build.sh
cd ..

echo "Building Speech-to-Text..."
cd speech-to-text
./build.sh
cd ..

echo "Building WhatsApp..."
cd whatsapp
./build.sh
cd ..

echo "Building News Worker..."
cd news-worker
./build.sh
cd ..

echo "Building Claude Code..."
cd claude-code
./build.sh
cd ..

echo "All builds completed successfully!"
