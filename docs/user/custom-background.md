# Custom background

In web or desktop, open **Settings → Appearance → Custom background**. Turn on the switch,
then select **Customize background**, or run **Customize background** from the command palette.
The picture button at the bottom of the sidebar has it too. The controls take over the
sidebar, and **Back** at the bottom returns you to your threads. Opening it from Settings
returns you to your last chat first. If there is no previous chat, the app opens a draft
for your most recently used project. With no projects yet, you can configure the background
behind the add-project screen.

Your current background configuration stays selected. Adjust it and watch your chat change
behind the sidebar. The panel stays open as you switch chats. Opening Settings, Usage, or
Pull requests closes it. Opening the theme editor closes the background panel, and vice
versa. Changes save automatically. **Enable custom background** in the panel and the switch
in Settings control the same preference. Turning either off hides the background everywhere
without deleting your selection or library. The panel stays open so you can turn it back
on. Select **None** to deselect the background.

## Backgrounds

A playlist is one or more pictures, a filter, and a fade. Create one with **New playlist**.
New playlists start without an image or filter. Choose images (JPEG, PNG, WebP,
or HEIC), then edit the name. Delete backgrounds from the background picker; deleting one
never deletes its images.

## Filters

Filters are shaders from Paper that repaint your picture. Their controls match the ones in
Paper's playgrounds, and every filter renders a single still frame.

- **Dithering**, or **No filter** to show the picture as is. Dithering starts from a **Look**
  preset. **Original** keeps the
  picture's colors, **Faded** does too and also sets the fade sliders so the bottom melts
  into your theme color, while **Violet**, **Terminal**, and **Mono** repaint it in a
  tinted palette. Every slider stays editable after picking one.

Filters need WebGL. In a browser without it the panel says so and turns the filter
selector off. The picture still shows, without its filter.

## Fade

The fade blends your theme's background color over the picture, so the tint always matches
the theme you picked. **Bottom fade** is how strong it is at the bottom edge; 100% goes solid.
**Fade height** is where the fade has eased away completely; at 100% it reaches the top, where
the chat text fades under the header. **Fade softness** is how long that ease is: low values
give a crisp edge, high values start easing lower down for a gentler fade. **Image opacity**
sets how much of the picture shows over your theme's background at all, and **Background blur**
softens the picture itself so busy photos sit further back.

**Brightness adapt** tunes each picture in a playlist on its own: the brighter a picture is
(or the darker, with a light theme), the more it lowers the image opacity and raises the bottom
fade, so a bright photo and a night sky can share one set of sliders. At 0% every picture shows
at the values you set. The line under it shows the current picture's lightness and the opacity
and fade it ends up with.

**Bubbles behind agent replies**, under **Theme and chats** at the bottom of the panel, sets
the text of agent replies on a translucent bubble, like your own messages. **Bubble opacity**
and **Bubble blur** tune both kinds of bubble; blur costs some scrolling smoothness, so it starts off.
**Thicker reply text** adds a glow in the text's own color, which keeps replies readable on a
clear bubble or with no bubble at all. The pencil next to the playlist renames it.

## Images

Images are resized, converted to WebP, and stored on this client only. Uploading the same
file twice reuses the stored copy. The image picker lists every stored image, lets you
upload another, and deletes the ones no background uses.

Select more than one image to rotate through them. **Change every** sets how long each
stays up. **Order** plays them as picked or shuffles them; shuffle shows every image once
before any repeats and never shows the same one twice in a row. **Transition** is a slow
crossfade or a plain cut. Rotation follows the clock, so every window and reload
shows the same image at the same time. The picture button at the bottom of the sidebar
steps to the next or previous image; the panel has the same **Next** and **Previous**
buttons for trying transitions out. Images stay on this client when you
connect to remote environments; other browsers and devices keep their own appearance.

## Phone background

T3 Code Mobile has its own background, set on the phone in **Settings → Appearance →
Wallpaper**. **Add photos** picks pictures from the phone's library; tap a picture to remove it.
The pictures stay on the phone, so the background works with any computer, or none. It shows
behind home and threads, cropped to fill the screen.

**Sync a folder** follows a folder on the phone, such as Camera or Screenshots, instead of
copying pictures: photos added to it join the rotation and deleted ones drop out, whenever the
picture changes or you return to the app. It needs access to all photos; with Android's
**Allow limited access**, a folder shows only the photos you selected. Tap a synced folder to
stop syncing it.

The same screen sets how often the pictures change, their order, and whether they fade or cut,
plus the bottom fade, picture opacity, and background blur. **Bubbles behind agent replies** sets each reply on a
translucent bubble so it stays readable over bright pictures; it starts on, and **Bubble
opacity** tunes it. **Colors from pictures** themes the app from the picture showing, and **Show
behind home and threads** hides the background without deleting it. Turn on **Quick adjust
button** to get a small button on home and threads that opens the fade, blur, and bubble
controls in a drawer, so you see each change on the screen behind it.

While a picture's colors theme the app, on the phone or the desktop, the theme cards are hidden,
since no theme choice would show. Turn off the picture colors to pick a theme again. On the
desktop and web, a black-and-white picture has no color to lend, so your selected theme stays
while it shows.

## New chats and conversations

While custom backgrounds are enabled, the selected background appears on new chats and
stays there once you submit your first prompt. Changes take effect immediately, including
while the panel is open, and the switch keeps its value after a refresh.

**Restore defaults** deselects the background and turns the switch back on, but keeps your
library.
