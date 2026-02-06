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

echo "All builds completed successfully!"
