import { Module } from "@nestjs/common";
import { DashboardModule } from "../dashboard/dashboard.module";
import { DocxRenderer } from "./renderers/docx.renderer";
import { DownloadRenderer } from "./renderers/download.renderer";
import { HtmlRenderer } from "./renderers/html.renderer";
import { MarkdownRenderer } from "./renderers/md.renderer";
import { PdfRenderer } from "./renderers/pdf.renderer";
import {
  FILE_RENDERERS,
  FileRendererRegistry,
  type FileRenderer,
} from "./renderers/renderer";
import { ReviewController } from "./review.controller";
import { ReviewStateStore } from "./review-state.store";
import { ReviewService } from "./review.service";

@Module({
  // DashboardModule owns and exports the single GitHubSource seam (real `fetch`,
  // overridden by the in-memory fake in tests); the review surface reuses it.
  imports: [DashboardModule],
  controllers: [ReviewController],
  providers: [
    ReviewService,
    ReviewStateStore,
    FileRendererRegistry,
    DownloadRenderer,
    MarkdownRenderer,
    DocxRenderer,
    HtmlRenderer,
    PdfRenderer,
    // The renderer set collected under one token. Each slice registers its renderer
    // (#8 md, #9 docx, #10 html + pdf) by adding its class to the providers, the
    // factory's `inject`, and the returned array - the existing renderers and the
    // registry stay untouched. #10 closes the set with the html and pdf renderers.
    {
      provide: FILE_RENDERERS,
      useFactory: (
        download: DownloadRenderer,
        md: MarkdownRenderer,
        docx: DocxRenderer,
        html: HtmlRenderer,
        pdf: PdfRenderer,
      ): FileRenderer[] => [download, md, docx, html, pdf],
      inject: [
        DownloadRenderer,
        MarkdownRenderer,
        DocxRenderer,
        HtmlRenderer,
        PdfRenderer,
      ],
    },
  ],
})
export class ReviewModule {}
