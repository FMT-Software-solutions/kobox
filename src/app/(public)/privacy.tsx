import { Linking, View } from 'react-native';

import { PublicPage } from '@/components/shared/public-page';
import { Text } from '@/components/ui/text';

const CONTACT = 'privacy@fmtsoftware.com';

/** A fixed date, changed by hand when the policy changes — never "today". */
const UPDATED = '11 September 2026';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <Text variant="heading">{title}</Text>
      {children}
    </View>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <Text className="leading-6 text-foreground">{children}</Text>;
}

function Item({ children }: { children: React.ReactNode }) {
  return (
    <View className="flex-row gap-2 pl-1">
      <Text className="leading-6 text-foreground">•</Text>
      <Text className="flex-1 leading-6 text-foreground">{children}</Text>
    </View>
  );
}

/**
 * Kobox privacy policy.
 *
 * Written against what the system actually does — every processor named here
 * is one the code calls, and the deletion section matches
 * `20260911050000_account_deletion.sql`. Change one, change the other.
 */
export default function PrivacyScreen() {
  return (
    <PublicPage title="Privacy policy">
      <Text variant="caption">Last updated {UPDATED}</Text>

      <P>
        Kobox helps groups keep track of dues, contributions and savings. It is made by FMT Software
        Solutions. This policy explains what Kobox collects and what happens to it.
      </P>

      <Section title="What we collect">
        <Item>Your name, phone number, and email if you sign in with one.</Item>
        <Item>A profile photo, if you add one.</Item>
        <Item>
          Group records: memberships, roles, contributions, payments, expenses and messages, entered
          by you or by your group&rsquo;s admins.
        </Item>
        <Item>A notification token for your device, so we can send push notifications.</Item>
        <Item>
          SMS credit purchases. Card and mobile money details are handled by Paystack; we never see
          them.
        </Item>
      </Section>

      <Section title="How we use it">
        <Item>To run your group&rsquo;s records and show balances and receipts.</Item>
        <Item>To send sign-in codes, receipts, reminders and messages from your group.</Item>
        <Item>To keep Kobox secure and working.</Item>
        <P>We do not sell your information or use it for advertising.</P>
      </Section>

      <Section title="Who can see it">
        <Item>
          Members of your group, according to their role. Admins and treasurers see the
          group&rsquo;s records; members see their own.
        </Item>
        {/* Categories, not vendor names. Naming each one ties the policy to
            suppliers we may change, and says nothing a reader needs. Paystack
            is the exception: people hand it their card details, so they should
            know whose form they are filling in. */}
        <Item>
          Service providers that help us run Kobox: cloud hosting and database, text message
          delivery, and push notification delivery. Payments are processed by Paystack. We can name
          our current providers on request.
        </Item>
      </Section>

      <Section title="Deleting your account">
        <P>
          You can delete your account at any time in the app under Settings, or at
          kobox.fmtsoftware.com/delete-account.
        </P>
        <Item>Your account, profile, photo and devices are deleted.</Item>
        <Item>Groups where you are the only person with an account are deleted too.</Item>
        <Item>
          In groups other people still use, the records of your payments stay, because they are part
          of that group&rsquo;s accounts. They are no longer linked to you. To have them removed,
          contact us at the address below.
        </Item>
      </Section>

      <Section title="Security">
        <P>
          Your information is stored with access controls that limit each person to the groups they
          belong to, and it is encrypted in transit.
        </P>
      </Section>

      <Section title="Children">
        <P>Kobox is not intended for children under 13.</P>
      </Section>

      <Section title="Changes">
        <P>If this policy changes, the date at the top changes with it.</P>
      </Section>

      <Section title="Contact">
        <Text
          accessibilityRole="link"
          onPress={() => Linking.openURL(`mailto:${CONTACT}`)}
          className="font-semibold text-primary">
          {CONTACT}
        </Text>
      </Section>
    </PublicPage>
  );
}
