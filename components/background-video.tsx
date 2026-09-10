"use client";

import { useEffect, useRef } from "react";

/**
 * 背景循环视频：静音、自动播放、循环，铺满所属层（父层负责视差与缩放）。
 * 海报图用同一张背景照片，视频没就绪前先显示它，接不上也不会闪白。
 *
 * 放大态（.scene-zoomed）会**冻住一帧**：镜头畸变是 SVG 滤镜，而滤镜一旦套住 <video>
 * 就掉到约 13fps（同一张静态图是 60fps——实测 video 79ms/帧、img 16.7ms/帧）。
 * 所以进放大态时把当前帧画进画布、转成 <img class="bg-frame"> 盖在视频上，
 * 滤镜只挂在这张静态图上（见 globals.css），畸变照旧、帧率回满；
 * 两帧内容逐像素相同，切换看不出接缝。退出放大态时揭掉快照、视频从原处继续。
 * 「减少动态效果」下全程不播，停在第一帧。
 */
export function BackgroundVideo({ src, poster }: { src: string; poster: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    const frame = frameRef.current;
    if (!video || !frame) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      video.pause();
      video.currentTime = 0;
      return;
    }

    // 冻帧淡入的时长（与 .bg-frame 的 transition 一致）+ 一点余量
    const FRAME_FADE = 150;
    let hideTimer = 0;

    const sync = () => {
      clearTimeout(hideTimer);
      const zoomed = document.documentElement.classList.contains("scene-zoomed");
      if (zoomed) {
        if (!video.paused) video.pause();
        if (video.readyState >= 2 && video.videoWidth) {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
          frame.src = canvas.toDataURL("image/jpeg", 0.9);
          // 冻帧带着畸变滤镜从 0 淡到 1：视频还压在下面，所以畸变是「渐变进来」的，
          // 不是啪一下挂上；等它淡完再把视频撤出渲染（撤了才省下每帧的滤镜开销）。
          frame.style.opacity = "1";
          hideTimer = window.setTimeout(() => {
            video.style.display = "none";
          }, FRAME_FADE + 60);
        }
        return;
      }
      // 退出放大态：先把视频放回渲染并让它画出一帧，再揭掉快照，接缝不闪
      video.style.display = "";
      if (video.paused) void video.play();
      requestAnimationFrame(() => {
        frame.style.opacity = "0";
      });
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      observer.disconnect();
      clearTimeout(hideTimer);
    };
  }, []);

  return (
    <>
      <video
        ref={videoRef}
        className="size-full object-cover"
        src={src}
        poster={poster}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden
      />
      <img
        ref={frameRef}
        alt=""
        aria-hidden
        className="bg-frame absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-150"
      />
    </>
  );
}
