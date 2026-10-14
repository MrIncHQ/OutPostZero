OUTPOST ZERO - PORTABLE WINDOWS BUILD
=====================================

1. Copy this entire folder to the root of your external drive.
2. Keep every file and folder together.
3. Double-click Run_Outpost_Zero.bat.
4. On first launch, choose a local display name. The device identity is
   generated and stored only inside this portable folder.
5. Use the navigation, Storage Inspector, Module Center, Update Center,
   hardware diagnostics, and Settings.
   Startup does not scan every content file. Open the Storage Inspector when
   you want a current storage breakdown.
   GitHub update checks occur only when you select CHECK FOR UPDATES.
   In Library, install the Kiwix engine and add the 41 KB test library to
   verify real offline ZIM browsing before downloading large archives.
   In Documents, choose IMPORT DOCUMENTS or copy files beneath Content/PDFs
   and Content/Documents and select SCAN FOLDERS. PDF reading, page search,
   bookmarks, notes, and annotations work inside Outpost Zero without an
   installed browser or internet connection. Images and image-only PDFs can
   use bundled English OCR; recognized text is added to local document search.
   Large scanned PDFs are processed in saved ten-page batches, while PDF pages
   that already contain searchable text are skipped.
   Learning imports portable course folders containing course.json plus
   Markdown or text lessons. Course progress is stored only on this drive.
   Notes autosave Markdown on this drive and can carry local attachments.
   Tools run entirely in the app. Maps lets you search for and explicitly
   confirm a location, then downloads only the chosen region from the official
   Protomaps daily OpenStreetMap build. You can also import an existing
   PMTiles/MBTiles package. Saved places, measurements, and GPX files remain
   available offline.
   Local Relay provides opt-in LAN discovery, device verification, TLS 1.3
   direct and room messages, and explicitly accepted encrypted file transfers.
   It never creates firewall rules or needs internet access. Start it on two
   Outposts connected to the same local network, compare the displayed
   verification code, then mark the device verified. Received files are saved
   only to a selected library folder on this portable drive.
   Local AI is optional and never downloads or starts automatically. Open
   Local AI to inspect the connected computer, install the portable llama.cpp
   runtime, optional portable GPU accelerator, and one verified model. Outpost
   Zero recommends a safe tier from the current CPU and RAM but still shows
   every model. A real GPU uses the portable Vulkan backend when available and
   automatically falls back to CPU without installing drivers. If this drive is
   moved to a weaker computer, an incompatible installed model is kept but
   locked until you select a supported lower tier or no model. Questions can
   use read-only matches from indexed documents and installed Kiwix libraries;
   the answer displays the local sources it received and streams as it is
   generated with elapsed-time and speed feedback. Conversational questions
   are reduced to useful offline search phrases across all compatible installed
   libraries. Current time and date come from the connected computer without
   internet access. The 0.6B model is fast but basic; use a compatible 4B or 8B
   model for stronger knowledge and reasoning. Select a displayed source to
   open its exact PDF page or offline Kiwix article. Press Enter to send a
   prompt, or Shift+Enter for a new line. A cold model load from a slower drive
   can take several minutes; one click starts it and shows elapsed time while
   it loads. AI output can be wrong,
   so verify important medical, legal, safety, and technical guidance.
6. Before unplugging the drive, choose PREPARE DRIVE FOR REMOVAL in the app,
   close Outpost Zero, and use Windows Safely Remove Hardware.

Outpost Zero stores its controlled data beneath this folder. Do not move the
EXE away from the .outpost-zero-root marker or the other bundled files.
