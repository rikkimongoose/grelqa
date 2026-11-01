import { requireVerifiedUser } from "@/auth/session";
import { ContestSettingsForm } from "@/components/manage-forms";
export const metadata = { title: "Новый конкурс" };
export default async function NewContestPage() {
  const user = await requireVerifiedUser();
  return <section><h1>Новый конкурс</h1><p>Создание не публикует конкурс. После проверки настроек опубликуйте подготовку отдельным действием.</p><ContestSettingsForm initial={{ title: "", description: "", discussionUrl: "", ownerEmail: user.email, coordinatorEmail: "", submissionsStartAt: "", submissionsEndAt: "", roundOneStartAt: "", roundTwoStartAt: "", endsAt: "", groupCapacity: 20, finalCapacity: 20, minLength: 0, maxLength: 0 }} /></section>;
}
