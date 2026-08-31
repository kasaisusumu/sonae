import { redirect } from "next/navigation";

// 学習内容は節約額ダッシュボードだったページ（/savings）に移動した
export default function LearningRedirect() {
  redirect("/savings");
}
