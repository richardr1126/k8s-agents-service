import { cookies } from "next/headers";
import { HAD_THREADS_COOKIE } from "@/lib/utils";
import { Assistant } from "./assistant";

export default async function Home() {
  const hadThreads = (await cookies()).get(HAD_THREADS_COOKIE)?.value === "1";
  return <Assistant hadThreads={hadThreads} />;
}
