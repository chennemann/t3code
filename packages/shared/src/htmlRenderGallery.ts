/**
 * Image galleries for framed HTML renders, built on upstream's open-image
 * notification. A clicked page image (or `window.t3.openImages`) sends the
 * same notification with the complete ordered gallery attached, so clients
 * that only read `src` and `name` still open the selected image.
 */

// Matches OPEN_IMAGE_METHOD in htmlRender.ts, which does not export it.
const OPEN_IMAGE_METHOD = "t3/notifications/open-image";
const MAX_GALLERY_IMAGES = 200;
const MAX_IMAGE_NAME_LENGTH = 1000;
const DISPLAYABLE_IMAGE_SRC = /^(?:https?:\/\/|data:image\/)/i;

export interface HtmlRenderImage {
  readonly src: string;
  readonly name: string;
}

/** The complete gallery and its selected image, shared by the web and mobile viewers. */
export function readHtmlRenderImageGallery(
  data: unknown,
): { readonly images: HtmlRenderImage[]; readonly index: number } | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const { jsonrpc, method, params } = data as Record<string, unknown>;
  if (jsonrpc !== "2.0" || method !== OPEN_IMAGE_METHOD) return undefined;
  if (typeof params !== "object" || params === null) return undefined;
  const { src, name, images, index } = params as Record<string, unknown>;
  if (images === undefined) {
    // A plain upstream notification carries one image.
    const image = readImage({
      src,
      name: typeof name === "string" && name.trim() ? name : "Image",
    });
    return image ? { images: [image], index: 0 } : undefined;
  }
  if (
    !Array.isArray(images) ||
    images.length === 0 ||
    images.length > MAX_GALLERY_IMAGES ||
    typeof index !== "number" ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= images.length
  ) {
    return undefined;
  }
  const gallery: HtmlRenderImage[] = [];
  for (const candidate of images) {
    const image = readImage(candidate);
    if (!image) return undefined;
    gallery.push(image);
  }
  return { images: gallery, index };
}

function readImage(value: unknown): HtmlRenderImage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { src, name } = value as Record<string, unknown>;
  // These are displayable image bytes/URLs, never paths in the reader's environment.
  if (typeof src !== "string" || !DISPLAYABLE_IMAGE_SRC.test(src)) return undefined;
  if (typeof name !== "string" || name.length === 0 || name.length > MAX_IMAGE_NAME_LENGTH) {
    return undefined;
  }
  return { src, name };
}

/** Agent-facing instructions for handing a gallery to the existing image viewer. */
export const HTML_RENDER_IMAGE_GUIDE =
  'Clicking an <img> outside a link or button opens T3’s image viewer with all images in document order, including hidden slides; web and desktop offer their existing annotation tools there. Use data-t3-gallery on a container to scope a gallery; use data-t3-image-viewer="off" on decorative images to opt out. For galleries that only mount the current slide, or whose thumbnails are buttons, call window.t3.openImages([{src, name}, ...], selectedIndex) from a click handler, passing the complete ordered image list (up to 200), not just visible or selected images. Sources must be http(s) URLs or image data URIs; absolute local image paths in the HTML are inlined automatically.';

// Run before upstream's bootstrap; prevent handled clicks so its delayed single-image handler stands down.
// Preserve a page's explicit openImages list and leave images in links/buttons alone.
// Mobile posts to React Native instead of a parent frame.
export const HTML_RENDER_GALLERY_SCRIPT = `(function(){
  var M=${JSON.stringify(OPEN_IMAGE_METHOD)},S=/^(https?:\\/\\/|data:image\\/)/i,n=0;
  function post(images,index){
    n++;
    if(navigator.userActivation&&navigator.userActivation.isActive===false)return false;
    var image=images[index];
    if(!image)return false;
    var message={jsonrpc:"2.0",method:M,params:{src:image.src,name:image.name,images:images,index:index}};
    if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(JSON.stringify(message));return true;}
    if(window.parent!==window){window.parent.postMessage(message,"*");return true;}
    return false;
  }
  window.t3=Object.assign(window.t3||{},{openImages:post});
  document.addEventListener("click",function(e){
    if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
    var target=e.composedPath()[0];
    if(!target||target.tagName!=="IMG"||target.closest("a[href],button"))return;
    if(target.closest('[data-t3-image-viewer="off"]')){e.preventDefault();return;}
    var root=target.closest("[data-t3-gallery]")||document,images=[],seen=new Map();
    root.querySelectorAll("img").forEach(function(item){
      var src=item.currentSrc||item.src;
      if(item.closest('[data-t3-image-viewer="off"],a[href],button')||!S.test(src)||seen.has(src))return;
      seen.set(src,images.length);
      images.push({src:src,name:item.alt||item.title||"Image "+(images.length+1)+".png"});
    });
    var index=seen.get(target.currentSrc||target.src),before=n;
    if(index===undefined)return;
    function complete(event){
      window.removeEventListener("click",complete);
      if(event!==e||e.defaultPrevented)return;
      if(n!==before||post(images,index))e.preventDefault();
    }
    window.addEventListener("click",complete);
    setTimeout(function(){window.removeEventListener("click",complete);});
  },true);
})();`;
