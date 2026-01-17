#!/bin/bash
set -e

echo "Building Homepage..."
cd homepage
./build.sh
cd ..

echo "Building Speedtest..."
cd speedtest
./build.sh
cd ..

echo "All builds completed successfully!"
