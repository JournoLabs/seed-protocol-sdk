'use client'

import React, { useEffect, useState, HTMLAttributes } from 'react';
import {ImageSize} from '@/helpers/constants'

const {EXTRA_SMALL, SMALL, MEDIUM, LARGE, EXTRA_LARGE} = ImageSize

type OPFSImageProps = HTMLAttributes<HTMLImageElement> & {
    filename: string; // Input filename (without size or extension)
};


const OPFSImage: React.FC<OPFSImageProps> = ({ filename, ...props }) => {
  const [srcset, setSrcset] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
      const loadImageURLs = async () => {
          try {
              // Define the widths you want to generate srcset for
              const widths = [EXTRA_SMALL, SMALL, MEDIUM, LARGE, EXTRA_LARGE];

              // Ensure the filename is valid
              if (!filename || typeof filename !== 'string') {
                  throw new Error('Invalid filename provided.');
              }

              // Remove the file extension and replace it with `.webp`
              const baseFilename = filename.replace(/\.[^/.]+$/, ''); // Strip existing extension

              // Access the OPFS root directory
              const rootHandle = await navigator.storage.getDirectory();
              const srcsetParts: string[] = [];

              for (const width of widths) {
                  const filePath = `files/images/${width}/${baseFilename}.webp`;
                  const segments = filePath.split('/').filter(Boolean);

                  // Traverse the directory structure to find the file
                  let currentHandle: FileSystemDirectoryHandle = rootHandle;
                  for (let i = 0; i < segments.length - 1; i++) {
                      currentHandle = await currentHandle.getDirectoryHandle(segments[i]);
                  }

                  // Get the file handle
                  const fileHandle = await currentHandle.getFileHandle(segments[segments.length - 1]);
                  const file = await fileHandle.getFile();

                  // Create a Blob URL and add it to srcset
                  const blobUrl = URL.createObjectURL(file);
                  srcsetParts.push(`${blobUrl} ${width}w`);
              }

              // Join all parts to form the srcset
              setSrcset(srcsetParts.join(', '));
          } catch (err) {
              setError((err as Error).message);
          }
      };

      loadImageURLs();
  }, [filename]);

  useEffect(() => {
    return () => {
        if (srcset) {
            srcset.split(', ').forEach((srcPart) => {
                const [url] = srcPart.split(' ');
                URL.revokeObjectURL(url);
            });
        }
    };
}, [srcset]);

  if (error) {
      return <p>Error loading image: {error}</p>;
  }

  return (
    <img 
      srcSet={srcset} 
      sizes="(max-width: 100%) 100vw, 100%" 
      {...props} 
    />
  );
};

export default OPFSImage;
